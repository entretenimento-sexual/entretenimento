//src\app\account\guards\account-lifecycle.guard.ts
import { inject } from '@angular/core';
import { Router, type UrlTree, type CanActivateFn } from '@angular/router';
import { combineLatest, of, type Observable } from 'rxjs';
import { catchError, filter, map, switchMap, take, timeout } from 'rxjs/operators';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { PostAuthNavigationService } from 'src/app/register-module/data-access/post-auth-navigation.service';
import { AuthAppBlockService } from '@core/services/autentication/auth/auth-app-block.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { AUTH_GUARD_WAIT_MS, buildAuthRetryTree } from '@core/guards/_shared-guard/guard-utils';
import {
  isRestrictedAccountStatus,
  resolveAccountStatus,
} from './account-lifecycle-status.util';

/**
 * Guard para rotas protegidas do app.
 *
 * Regras:
 * - conta ativa e coerente com a sessão => segue;
 * - lifecycle restrito ou lock técnico => /conta/status;
 * - cadastro pendente ou documento ausente => próxima etapa canônica;
 * - não assume active enquanto CurrentUser ainda está unresolved;
 * - UID do perfil runtime precisa coincidir com o Auth canônico.
 *
 * Observação:
 * - este guard pode coexistir com o auth guard atual;
 * - se não houver sessão, o auth guard existente continua cuidando do redirect.
 */
export const accountLifecycleGuard: CanActivateFn = (
  route,
  state
): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const authSession = inject(AuthSessionService);
  const currentUserStore = inject(CurrentUserStoreService);
  const appBlock = inject(AuthAppBlockService);
  const navigation = inject(PostAuthNavigationService);
  const ageRegistrationRoute = route.data?.['allowPendingAgeRegistration'] === true;

  return combineLatest([
    authSession.ready$,
    authSession.authUser$,
    currentUserStore.user$,
    appBlock.reason$,
  ]).pipe(
    /**
     * Auth precisa estar pronto. Para sessão autenticada, esperamos apenas a
     * saída do tri-state `undefined` e descartamos a projeção de outra conta.
     */
    filter(([ready, authUser, appUser]) => {
      if (!ready) return false;
      if (!authUser || appBlock.domainBlockFor(authUser.uid)) return true;
      return appUser !== undefined && (appUser === null || appUser.uid === authUser.uid);
    }),
    take(1),
    timeout({ first: AUTH_GUARD_WAIT_MS, with: () => of(null) }),
    switchMap((value): Observable<boolean | UrlTree> => {
      if (!value) return of(buildAuthRetryTree(router, state.url));
      const [ready, authUser, appUser] = value;
      if (!authUser) {
        return of(true);
      }

      const context = {
        authReady: ready,
        authUid: authUser.uid,
        userResolved: appUser !== undefined,
        user: appUser,
      };

      const blockedReason = appBlock.domainBlockFor(authUser.uid);
      const status = resolveAccountStatus(context);
      if (!blockedReason && status === 'registration_pending' && ageRegistrationRoute) return of(true);
      if (!blockedReason && (status === 'registration_pending' || appUser === null)) {
        const redirect = ageRegistrationRoute
          ? router.parseUrl(state.url).queryParamMap.get('redirectTo')
          : state.url;
        return navigation.resolveForCurrentSession$(authUser.uid, redirect).pipe(
          map((target) => router.parseUrl(target)),
          catchError(() => of(buildAuthRetryTree(router, state.url)))
        );
      }

      if (blockedReason || isRestrictedAccountStatus(status)) {
        return of(router.createUrlTree(['/conta/status'], {
          queryParams: { redirectTo: state.url, ...(blockedReason ? { reason: blockedReason } : {}) },
        }));
      }

      return of(true);
    })
  );
};

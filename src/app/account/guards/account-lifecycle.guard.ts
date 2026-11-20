//src\app\account\guards\account-lifecycle.guard.ts
import { inject } from '@angular/core';
import { Router, type UrlTree, type CanActivateFn } from '@angular/router';
import { combineLatest, of, type Observable } from 'rxjs';
import { filter, map, take, timeout } from 'rxjs/operators';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { AuthAppBlockService } from '@core/services/autentication/auth/auth-app-block.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { AUTH_GUARD_WAIT_MS, buildAuthRetryTree, buildWelcomeRedirectTree } from '@core/guards/_shared-guard/guard-utils';
import {
  isRestrictedAccountStatus,
  resolveAccountStatus,
} from './account-lifecycle-status.util';

/**
 * Guard para rotas protegidas do app.
 *
 * Regras:
 * - conta ativa e coerente com a sessão => segue;
 * - lifecycle restrito, lock técnico ou estado desconhecido => /conta/status;
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
  const ageRegistrationRoute = route.data?.['allowPendingAgeRegistration'] === true;

  return combineLatest([
    authSession.ready$,
    authSession.authUser$,
    currentUserStore.user$,
  ]).pipe(
    /**
     * Auth precisa estar pronto. Para sessão autenticada, esperamos apenas a
     * saída do tri-state `undefined`. Na etapa de idade, também aguardamos
     * a troca de perfil quando o anterior pertence a outra sessão.
     */
    filter(([ready, authUser, appUser]) => {
      if (!ready) return false;
      if (!authUser) return true;
      return appUser !== undefined &&
        (!ageRegistrationRoute || appUser === null || appUser.uid === authUser.uid);
    }),
    take(1),
    map(([ready, authUser, appUser]) => {
      if (!authUser) {
        return true;
      }

      const context = {
        authReady: ready,
        authUid: authUser.uid,
        userResolved: appUser !== undefined,
        user: appUser,
      };

      const blockedReason = ageRegistrationRoute && appBlock.snapshot;
      const status = resolveAccountStatus(context);
      if (!blockedReason && status === 'registration_pending') {
        return ageRegistrationRoute || buildWelcomeRedirectTree(router, state.url, {
          reason: 'registration_pending',
        });
      }

      if (blockedReason || isRestrictedAccountStatus(status)) {
        return router.createUrlTree(['/conta/status'], {
          queryParams: { redirectTo: state.url, ...(blockedReason ? { reason: blockedReason } : {}) },
        });
      }

      return true;
    }),
    timeout({ first: AUTH_GUARD_WAIT_MS, with: () => of(buildAuthRetryTree(router, state.url)) })
  );
};

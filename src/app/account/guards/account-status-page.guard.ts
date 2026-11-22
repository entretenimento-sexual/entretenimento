//src\app\account\guards\account-status-page.guard.ts
import { inject } from '@angular/core';
import { Router, type UrlTree, type CanActivateFn } from '@angular/router';
import { combineLatest, of, type Observable } from 'rxjs';
import { catchError, filter, map, switchMap, take, timeout } from 'rxjs/operators';

import { AUTH_GUARD_WAIT_MS, buildAuthRetryTree } from '@core/guards/_shared-guard/guard-utils';
import { PostAuthNavigationService } from 'src/app/register-module/data-access/post-auth-navigation.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import {
  isRestrictedAccountStatus,
  resolveAccountStatus,
} from './account-lifecycle-status.util';

/**
 * Guard da rota /conta/status.
 *
 * Regras:
 * - lifecycle restrito, lock ou estado desconhecido => permite a página segura;
 * - conta ativa e coerente com a sessão => manda para /conta;
 * - se não há sessão, o auth guard já redireciona para login.
 */
export const accountStatusPageGuard: CanActivateFn = (_route, state): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const authSession = inject(AuthSessionService);
  const currentUserStore = inject(CurrentUserStoreService);
  const navigation = inject(PostAuthNavigationService);

  return combineLatest([
    authSession.ready$,
    authSession.authUser$,
    currentUserStore.user$,
  ]).pipe(
    filter(([ready, authUser, appUser]) => {
      if (!ready) return false;
      if (!authUser) return true;
      return appUser !== undefined && (appUser === null || appUser.uid === authUser.uid);
    }),
    take(1),
    timeout({ first: AUTH_GUARD_WAIT_MS, with: () => of(null) }),
    switchMap((value): Observable<boolean | UrlTree> => {
      if (!value) return of(buildAuthRetryTree(router, state.url));
      const [ready, authUser, appUser] = value;
      if (!authUser) return of(true);

      const status = resolveAccountStatus({
        authReady: ready,
        authUid: authUser.uid,
        userResolved: appUser !== undefined,
        user: appUser,
      });

      if (status === 'registration_pending') {
        return navigation.resolveForCurrentSession$(authUser.uid, null).pipe(
          map((target) => router.parseUrl(target)),
          catchError(() => of(buildAuthRetryTree(router, state.url)))
        );
      }

      if (isRestrictedAccountStatus(status)) {
        return of(true);
      }

      return of(router.createUrlTree(['/conta']));
    })
  );
};

//src\app\account\guards\account-status-page.guard.ts
import { inject } from '@angular/core';
import { Router, type UrlTree, type CanActivateFn } from '@angular/router';
import { combineLatest, of, type Observable } from 'rxjs';
import { filter, map, take, timeout } from 'rxjs/operators';

import { AUTH_GUARD_WAIT_MS, buildAuthRetryTree, buildWelcomeRedirectTree } from '@core/guards/_shared-guard/guard-utils';
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

  return combineLatest([
    authSession.ready$,
    authSession.authUser$,
    currentUserStore.user$,
  ]).pipe(
    filter(([ready, authUser, appUser]) => {
      if (!ready) return false;
      if (!authUser) return true;
      return appUser !== undefined;
    }),
    take(1),
    map(([ready, authUser, appUser]) => {
      if (!authUser) return true;

      const status = resolveAccountStatus({
        authReady: ready,
        authUid: authUser.uid,
        userResolved: appUser !== undefined,
        user: appUser,
      });

      if (status === 'registration_pending') {
        return buildWelcomeRedirectTree(router, undefined, { reason: 'registration_pending' });
      }

      if (isRestrictedAccountStatus(status)) {
        return true;
      }

      return router.createUrlTree(['/conta']);
    }),
    timeout({ first: AUTH_GUARD_WAIT_MS, with: () => of(buildAuthRetryTree(router, state.url)) })
  );
};

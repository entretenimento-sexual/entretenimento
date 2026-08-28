//src\app\account\guards\account-status-page.guard.ts
import { inject } from '@angular/core';
import { Router, type UrlTree, type CanActivateFn } from '@angular/router';
import { combineLatest, type Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import {
  isRestrictedAccountStatus,
  normalizeAccountStatus,
} from './account-lifecycle-status.util';

/**
 * Guard da rota /conta/status
 *
 * Regras:
 * - se conta ainda está bloqueada => permite
 * - se conta está ativa => manda para /conta
 * - se não há sessão, o auth guard já redireciona para login
 */
export const accountStatusPageGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
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
    map(([_, authUser, appUser]) => {
      if (!authUser) return true;

      const status = normalizeAccountStatus(appUser);

      if (isRestrictedAccountStatus(status)) {
        return true;
      }

      return router.createUrlTree(['/conta']);
    })
  );
};

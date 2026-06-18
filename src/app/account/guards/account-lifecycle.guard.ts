//src\app\account\guards\account-lifecycle.guard.ts
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
 * Guard para rotas protegidas do app.
 *
 * Regras:
 * - conta ativa => segue
 * - conta suspensa / exclusão pendente / deleted => manda para /conta/status
 * - não assume active enquanto CurrentUser ainda está unresolved
 *
 * Observação:
 * - este guard pode coexistir com o auth guard atual
 * - se não houver sessão, o auth guard existente continua cuidando do redirect
 */
export const accountLifecycleGuard: CanActivateFn = (
  _route,
  state
): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const authSession = inject(AuthSessionService);
  const currentUserStore = inject(CurrentUserStoreService);

  return combineLatest([
    authSession.ready$,
    authSession.authUser$,
    currentUserStore.user$,
  ]).pipe(
    /**
     * Espera:
     * - Auth pronto
     * - se autenticado, runtime do usuário precisa ter saído de undefined
     */
    filter(([ready, authUser, appUser]) => {
      if (!ready) return false;
      if (!authUser) return true;
      return appUser !== undefined;
    }),
    take(1),
    map(([_, authUser, appUser]) => {
      if (!authUser) {
        /**
         * Auth guard principal deve tratar isso.
         * Aqui não forçamos outro redirect para evitar duplicidade.
         */
        return true;
      }

      const status = normalizeAccountStatus(appUser);

      if (isRestrictedAccountStatus(status)) {
        return router.createUrlTree(['/conta/status'], {
          queryParams: { redirectTo: state.url },
        });
      }

      return true;
    })
  );
};

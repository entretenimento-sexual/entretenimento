//src\app\account\guards\account-lifecycle.guard.ts
import { inject } from '@angular/core';
import { Router, type UrlTree, type CanActivateFn } from '@angular/router';
import { combineLatest, type Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
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
     * Auth precisa estar pronto. Para sessão autenticada, esperamos apenas a
     * saída do tri-state `undefined`; `null` já é uma resolução real e será
     * tratada como `unknown` pela política canônica, sem fail-open.
     */
    filter(([ready, authUser, appUser]) => {
      if (!ready) return false;
      if (!authUser) return true;
      return appUser !== undefined;
    }),
    take(1),
    map(([ready, authUser, appUser]) => {
      if (!authUser) {
        return true;
      }

      const status = resolveAccountStatus({
        authReady: ready,
        authUid: authUser.uid,
        userResolved: appUser !== undefined,
        user: appUser,
      });

      if (isRestrictedAccountStatus(status)) {
        return router.createUrlTree(['/conta/status'], {
          queryParams: { redirectTo: state.url },
        });
      }

      return true;
    })
  );
};

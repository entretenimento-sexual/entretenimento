// src/app/core/guards/auth-guard/auth.guard.ts
// Guard de autenticação: protege rotas que exigem sessão válida.
//
// Propósito:
// - Evitar redirects prematuros no boot (cold start/refresh), aguardando "ready".
// - Retornar de forma determinística (boolean | UrlTree), sem router.navigate().
// - Em erro, falhar com segurança: redirecionar para /login + feedback e log centralizado.
import { inject } from '@angular/core';
import { CanActivateFn, Router, type GuardResult } from '@angular/router';
import { catchError, filter, map, of, switchMap, take, type Observable } from 'rxjs';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';

export const authGuard: CanActivateFn = (_route, state): Observable<GuardResult> => {
  const router = inject(Router);
  const currentUserStore = inject(CurrentUserStoreService);
  const globalError = inject(GlobalErrorHandlerService);
  const notify = inject(ErrorNotificationService);

  // 1) Espera o auth ficar "ready" (evita uid=null transitório no bootstrap).
  return currentUserStore.getAuthReady$().pipe(
    filter((ready) => ready === true),
    take(1),

    // 2) Snapshot 1x do uid após ready.
    switchMap(() => currentUserStore.getLoggedUserUID$().pipe(take(1))),

    map((uid): GuardResult => {
      const ok = !!uid;
      guardLog('auth', 'ready:true', 'uid:', uid, 'ok:', ok);

      // Autenticado -> permite.
      // Não autenticado -> manda pro login preservando redirect.
      return ok ? true : buildRedirectTree(router, '/login', state.url);
    }),

    // 3) Tratamento centralizado + feedback.
    catchError((err): Observable<GuardResult> => {
      globalError.handleError(err);
      notify.showError('Erro ao verificar sua sessão. Faça login novamente.');
      return of(buildRedirectTree(router, '/login', state.url, { reason: 'auth_error' }));
    })
  );
};

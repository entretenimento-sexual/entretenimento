// Não esqueça os comentáros explicativos sobre o propósito desse guard.
// src/app/core/guards/auth-guard/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, filter, map, of, switchMap, take } from 'rxjs';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';

/**
 * AUTH GUARD (CanActivate)
 *
 * Propósito:
 * - Proteger rotas que exigem autenticação (sessão válida).
 * - Evitar redirecionamento "prematuro" durante o bootstrap (cold start/refresh),
 *   aguardando o estado de autenticação ficar "ready" antes de decidir.
 * - Quando bloqueia, redireciona para /login preservando a URL original (redirectTo),
 *   para permitir retorno após login.
 *
 * Observação:
 * - Este guard deve ser "determinístico": NÃO faz router.navigate() aqui.
 *   Ele retorna boolean ou UrlTree (via buildRedirectTree).
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const currentUserStore = inject(CurrentUserStoreService);
  const globalError = inject(GlobalErrorHandlerService);
  const notify = inject(ErrorNotificationService);

  // ✅ 1) Espera o auth ficar "ready" (Firebase/NgRx já resolveu o estado inicial).
  //     Sem isso, o primeiro uid pode ser null temporariamente e causar redirect indevido.
  return currentUserStore.getAuthReady$().pipe(
    filter((ready) => ready === true),
    take(1),

    // ✅ 2) Só depois de ready=true, consulta o uid (snapshot 1x).
    switchMap(() => currentUserStore.getLoggedUserUID$().pipe(take(1))),

    map((uid) => {
      const ok = !!uid;
      guardLog('auth', 'ready:true', 'uid:', uid, 'ok:', ok);

      // Se autenticado, permite.
      // Se não, redireciona para /login com redirectTo=state.url.
      return ok ? true : buildRedirectTree(router, '/login', state.url);
    }),

    // ✅ 3) Tratamento centralizado de erro + feedback.
    catchError((err) => {
      globalError.handleError(err);
      notify.showError('Erro ao verificar sua sessão. Faça login novamente.');
      return of(buildRedirectTree(router, '/login', state.url, { reason: 'auth_error' }));
    })
  );
};

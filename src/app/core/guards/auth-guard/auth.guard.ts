// src/app/core/guards/auth-guard/auth.guard.ts
// Guard de autenticação: protege rotas que exigem sessão válida.
//
// Propósito:
// - evitar redirect prematuro no refresh/cold start
// - aguardar o auth ficar pronto
// - tolerar uma pequena janela de restauração do uid antes de decidir
// - retornar sempre boolean | UrlTree, sem router.navigate()
// - em erro, falhar com segurança para /login
import { inject } from '@angular/core';
import { CanActivateFn, Router, type GuardResult } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, filter, map, switchMap, take, timeout } from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';
/**
 * Janela curta para tolerar refresh/hidratação.
 *
 * Motivo:
 * - no seu fluxo, em alguns boots o store/auth publica uid:null primeiro,
 *   e só depois restaura o uid real da sessão.
 * - sem essa tolerância, o guard derruba a navegação e manda para /login
 *   mesmo quando a sessão ainda iria reaparecer.
 *
 * Ajuste fino:
 * - 2000ms é um valor seguro para dev/emulator e refresh local.
 * - se depois você comprovar que 1200ms já resolve, pode reduzir.
 */
const AUTH_REFRESH_GRACE_MS = 2000;

export const authGuard: CanActivateFn = (_route, state): Observable<GuardResult> => {
  const router = inject(Router);
  const currentUserStore = inject(CurrentUserStoreService);
  const globalError = inject(GlobalErrorHandlerService);
  const notify = inject(ErrorNotificationService);

  const toLogin = () => buildRedirectTree(router, '/login', state.url);

  return currentUserStore.getAuthReady$().pipe(
    /**
     * 1) Só decide quando a camada de auth disser que está pronta.
     *    Isso evita usar uid transitório antes da hora.
     */
    filter((ready) => ready === true),
    take(1),

    /**
     * 2) Snapshot inicial do uid.
     */
    switchMap(() => currentUserStore.getLoggedUserUID$().pipe(take(1))),

    /**
     * 3) Se já há uid, libera imediatamente.
     *    Se veio null, espera uma pequena janela reativa por restauração.
     */
    switchMap((uid): Observable<GuardResult> => {
      if (uid) {
        guardLog('auth', 'ready:true', 'uid:', uid, 'ok:', true, 'url:', state.url);
        return of(true);
      }

      guardLog(
        'auth',
        'ready:true but uid:null -> aguardando janela de restauração',
        { url: state.url, waitMs: AUTH_REFRESH_GRACE_MS }
      );

      return currentUserStore.getLoggedUserUID$().pipe(
        /**
         * Espera apenas uid válido.
         * Se a sessão reaparecer dentro da janela, a rota segue.
         */
        filter((restoredUid): restoredUid is string => !!restoredUid),
        take(1),
        timeout({
          first: AUTH_REFRESH_GRACE_MS,
          with: () => of(null),
        }),
        map((restoredUid): GuardResult => {
          const ok = !!restoredUid;

          guardLog(
            'auth',
            'after grace',
            'uid:',
            restoredUid,
            'ok:',
            ok,
            'url:',
            state.url
          );

          return ok ? true : toLogin();
        })
      );
    }),

    /**
     * 4) Falha segura.
     */
    catchError((err): Observable<GuardResult> => {
      globalError.handleError(err);
      notify.showError('Erro ao verificar sua sessão. Faça login novamente.');
      return of(buildRedirectTree(router, '/login', state.url, { reason: 'auth_error' }));
    })
  );
};

// src/app/core/guards/auth-guard/auth.guard.ts
// Guard de autenticação operacional das rotas protegidas.
//
// - AuthSessionService é a fonte canônica de ready/UID/encerramento;
// - tolera a janela legada de restauração durante refresh;
// - interrompe essa tolerância imediatamente quando o logout começa;
// - devolve boolean | UrlTree, sem navegação imperativa;
// - falha fechado com tratamento centralizado de erros.
import { inject } from '@angular/core';
import { CanActivateFn, Router, type GuardResult } from '@angular/router';
import { combineLatest, Observable, of } from 'rxjs';
import { catchError, filter, map, switchMap, take, timeout } from 'rxjs/operators';

import { AuthAppBlockService } from '../../services/autentication/auth/auth-app-block.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  AUTH_GUARD_WAIT_MS,
  buildAuthRetryTree,
  buildRedirectTree,
  guardLog,
} from '../_shared-guard/guard-utils';

/**
 * Preservamos os 2 segundos de tolerância para refresh/cold start existentes.
 * Essa espera nunca se aplica a uma sessão explicitamente em encerramento.
 */
const AUTH_REFRESH_GRACE_MS = 2000;

export const authGuard: CanActivateFn = (_route, state): Observable<GuardResult> => {
  const router = inject(Router);
  const authSession = inject(AuthSessionService);
  const applicationError = inject(ApplicationErrorService);
  const notify = inject(ErrorNotificationService);

  const appBlock = inject(AuthAppBlockService);
  const toLogin = (showReason = true) => buildRedirectTree(
    router, '/login', state.url, showReason
      ? { reason: appBlock.invalidationSnapshot?.reason ?? 'session-ended' }
      : undefined
  );

  return combineLatest([
    authSession.ready$,
    authSession.uid$,
    authSession.isTerminating$,
  ]).pipe(
    // Encerramento explícito não precisa aguardar a hidratação Firebase.
    filter(([ready, , terminating]) => ready === true || terminating === true),
    take(1),
    switchMap(([, uid, terminating]): Observable<GuardResult> => {
      if (terminating) {
        guardLog('auth', 'session terminating -> deny', { url: state.url });
        return of(toLogin(false));
      }

      if (uid) {
        if (appBlock.snapshot === 'auth-invalid' && appBlock.invalidationSnapshot?.uid === uid) {
          return of(toLogin());
        }
        guardLog('auth', 'ready:true', 'uid:', uid, 'ok:', true, 'url:', state.url);
        return of(true);
      }

      if (appBlock.invalidationSnapshot && !authSession.currentAuthUser) return of(toLogin());

      // Compatibilidade com a restauração tardia do UID no bootstrap.
      // O mesmo Observable observa o logout para não aguardar o timeout.
      guardLog('auth', 'ready:true, uid:null -> restoration grace', {
        url: state.url,
        waitMs: AUTH_REFRESH_GRACE_MS,
      });

      return combineLatest([
        authSession.uid$,
        authSession.isTerminating$,
      ]).pipe(
        filter(([restoredUid, isTerminating]) => !!restoredUid || isTerminating),
        take(1),
        map(([restoredUid, isTerminating]) => !isTerminating && !!restoredUid &&
          !(appBlock.snapshot === 'auth-invalid' && appBlock.invalidationSnapshot?.uid === restoredUid)),
        timeout({
          first: AUTH_REFRESH_GRACE_MS,
          with: () => of(false),
        }),
        map((authorized): GuardResult => {
          guardLog('auth', 'restoration finished', {
            ok: authorized,
            url: state.url,
          });
          return authorized ? true : toLogin(!authSession.isTerminatingSnapshot);
        })
      );
    }),
    timeout({ first: AUTH_GUARD_WAIT_MS, with: () => of(buildAuthRetryTree(router, state.url)) }),
    catchError((err): Observable<GuardResult> => {
      try {
        applicationError.report(err, {
          feature: 'auth-guard',
          operation: 'authGuard',
          fallbackMessage: 'Erro ao verificar sua sessão. Faça login novamente.',
          presentation: { surface: 'none', severity: 'error' },
          metadata: { scope: 'authGuard' },
        });
      } catch {
        // Falha de telemetria não impede decisão fail-closed.
      }
      notify.showError('Erro ao verificar sua sessão. Faça login novamente.');
      return of(buildRedirectTree(router, '/login', state.url, { reason: 'auth_error' }));
    })
  );
};

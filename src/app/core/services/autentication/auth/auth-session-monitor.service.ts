// src/app/core/services/autentication/auth/auth-session-monitor.service.ts
// =============================================================================
// AUTH SESSION MONITOR SERVICE
//
// Responsabilidade única:
// - Monitorar periodicamente a validade técnica da sessão Firebase Auth
// - Detectar token inválido, usuário desabilitado, sessão expirada, etc.
// - Acionar hard sign-out apenas quando o Auth realmente estiver inválido
//
// Não faz:
// - Não decide rota de registro
// - Não observa users/{uid}
// - Não bloqueia app por regra de domínio
// - Não conhece CurrentUserStore
//
// Observação arquitetural:
// - Este service substitui a responsabilidade de keepAlive antes embutida
//   no AuthOrchestratorService.
// - O AuthOrchestratorService continua decidindo quando esse monitor deve
//   iniciar e parar.
// =============================================================================

import { Injectable } from '@angular/core';
import { from, of, Subscription, timer } from 'rxjs';
import { catchError, exhaustMap, map } from 'rxjs/operators';

import { AuthSessionService } from './auth-session.service';
import { LogoutService } from './logout.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthSessionMonitorService {
  private static readonly MONITOR_INTERVAL_MS = 600_000;

  private keepAliveSub: Subscription | null = null;
  private readonly debug = !environment.production;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly logoutService: LogoutService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
  ) {}

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AuthSessionMonitor] ${message}`, extra ?? '');
  }

  /**
   * Inicia o monitor periódico da sessão.
   *
   * Regra:
   * - idempotente
   * - só um timer ativo por vez
   */
  start(): void {
    if (this.keepAliveSub) return;

    this.dbg('start()');

    this.keepAliveSub = timer(
      AuthSessionMonitorService.MONITOR_INTERVAL_MS,
      AuthSessionMonitorService.MONITOR_INTERVAL_MS
    )
      .pipe(
        exhaustMap(() => {
          const currentUser = this.authSession.currentAuthUser;
          if (!currentUser) return of(null);

          return from(currentUser.reload()).pipe(
            map(() => null),
            catchError((err: any) => {
              const code = String(err?.code || '');

              if (
                code === 'auth/user-token-expired' ||
                code === 'auth/user-disabled' ||
                code === 'auth/user-not-found' ||
                code === 'auth/invalid-user-token'
              ) {
                this.dbg('invalid auth detected', { code });
                this.logoutService.hardSignOutToWelcome('auth-invalid');
                return of(null);
              }

              this.reportSilent(err, {
                phase: 'session-monitor.reload',
                code,
              });

              return of(null);
            })
          );
        }),
        catchError((err) => {
          this.reportSilent(err, { phase: 'session-monitor.pipeline' });
          return of(null);
        })
      )
      .subscribe();
  }

  /**
   * Interrompe o monitor periódico.
   */
  stop(): void {
    if (!this.keepAliveSub) return;

    this.keepAliveSub.unsubscribe();
    this.keepAliveSub = null;

    this.dbg('stop()');
  }

  private reportSilent(err: unknown, context: Record<string, unknown>): void {
    try {
      const error = new Error('[AuthSessionMonitor] internal error');
      (error as any).silent = true;
      (error as any).skipUserNotification = true;
      (error as any).original = err;
      (error as any).context = context;

      this.globalErrorHandler.handleError(error);
    } catch {
      // noop
    }
  }
} // linha 130, fim do auth-session-monitor.service.ts

// src/app/core/services/autentication/auth/auth-session-monitor.service.ts
// =============================================================================
// AUTH SESSION MONITOR SERVICE
//
// Responsabilidade única:
// - Monitorar periodicamente a validade técnica da sessão Firebase Auth
// - Detectar token inválido, usuário desabilitado, sessão expirada, etc.
// - Registrar invalidação confirmada da sessão para a interface
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
import { EMPTY, from, of, Subscription, timer } from 'rxjs';
import { catchError, exhaustMap, map } from 'rxjs/operators';

import { AuthSessionService } from './auth-session.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

@Injectable({ providedIn: 'root' })
export class AuthSessionMonitorService {
  private static readonly MONITOR_INTERVAL_MS = 600_000;

  private keepAliveSub: Subscription | null = null;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly applicationError: ApplicationErrorService,
    private readonly privacyDebug: PrivacyDebugLoggerService,
  ) {}

/**
 * Debug seguro do monitor técnico da sessão.
 *
 * Canal:
 * localStorage.setItem('DEBUG_AUTH', '1');
 *
 * Este service não costuma logar UID, mas lida com validade de token,
 * usuário desabilitado e sessão inválida. Fica no canal auth.
 */
private dbg(message: string, extra?: unknown): void {
  this.privacyDebug.log('auth', `AuthSessionMonitor: ${message}`, extra);
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
          // O Firebase user técnico pode persistir até o signOut efetivo.
          if (this.authSession.isTerminatingSnapshot) return of(null);
          const currentUser = this.authSession.currentAuthUser;
          if (!currentUser) return of(null);
          const termination = this.authSession.terminationVersionSnapshot;

          // O SDK pode emitir UID nulo e parar o timer antes de relançar
          // o erro. Tratamos o resultado na promessa que iniciou o reload.
          const reload = Promise.resolve().then(() =>
            this.authSession.currentAuthUser === currentUser &&
            !this.authSession.isTerminatingSnapshot ? currentUser.reload() : undefined
          ).catch((error: unknown) => {
            const code = (error as { code?: unknown } | null)?.code ?? '';
            if (this.authSession.recordReloadFailure(currentUser, termination, error)) {
              this.reportSilent(error, { phase: 'session-monitor.invalid', code });
            } else if (this.authSession.currentAuthUser === currentUser &&
                !this.authSession.isTerminatingSnapshot &&
                this.authSession.terminationVersionSnapshot === termination) {
              this.reportSilent(error, {
                phase: 'session-monitor.reload',
                code,
              });
            }
          });
          return from(reload).pipe(map(() => null));
        }),
        catchError((err) => {
          this.reportSilent(err, { phase: 'session-monitor.pipeline' });
          return EMPTY;
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
      const phase =
        typeof context['phase'] === 'string' && context['phase'].trim()
          ? context['phase'].trim()
          : 'internal';

      this.applicationError.report(err, {
        feature: 'auth-session-monitor',
        operation: phase,
        fallbackMessage:
          'Não foi possível concluir uma verificação técnica da sessão.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'AuthSessionMonitorService',
          ...context,
        },
      });
    } catch {
      // Diagnóstico secundário não interfere no monitor da sessão.
    }
  }
} // linha 130, fim do auth-session-monitor.service.ts

// src/app/core/services/presence/presence-orchestrator.service.ts
// =============================================================================
// PRESENCE ORCHESTRATOR
//
// Responsabilidade:
// - Consumir SOMENTE gates canônicos do AccessControlService (fonte única).
// - Iniciar/parar PresenceService de forma idempotente e determinística.
// - Não duplicar "verdades" (ready$, uid$, router, inReg) aqui.
//
// Gate usado aqui:
// - access.canRunPresence$
//   => sessão válida + camada adulta de compliance válida;
//   => não exige e-mail verificado, porque presença própria não depende dele.
//
// Motivação:
// - não iniciar heartbeat antes de idade/termos/consentimento estarem válidos;
// - evitar writes que Rules recusariam, ruído de permission-denied e custo;
// - retomar automaticamente quando a projeção canônica liberar o usuário.
// =============================================================================
import { DestroyRef, Injectable, inject } from '@angular/core';
import { defer, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { PresenceService } from './presence.service';
import { PrivacyDebugLoggerService } from '../privacy/privacy-debug-logger.service';

@Injectable({ providedIn: 'root' })
export class PresenceOrchestratorService {
  private readonly destroyRef = inject(DestroyRef);
  private started = false;
  private lastNotifyAt = 0;

  constructor(
    private readonly access: AccessControlService,
    private readonly presence: PresenceService,
    private readonly applicationError: ApplicationErrorService,
    private readonly notify: ErrorNotificationService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) { }

  start(): void {
    if (this.started) return;
    this.started = true;

    // ✅ Gate canônico (fonte única)
    const can$ = this.access.canRunPresence$.pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    /**
     * ✅ UID canônico com normalização
     * - aqui é o trecho que você perguntou: this.access.authUid$.pipe(...)
     */
    const authUid$ = this.access.authUid$.pipe(
      map((uid) => (uid ?? '').trim() || null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    /**
     * ✅ DRIVER EXTERNO = authUid$
     * - Qualquer troca de UID cancela o inner stream imediatamente.
     * - can$ continua sendo a fonte única de elegibilidade operacional.
     * - Resultado final: uid desejado (string) ou null
     */
    const desiredUid$ = authUid$.pipe(
      switchMap((uid) =>
        can$.pipe(
          map((can) => (can === true && !!uid ? uid : null)),
          distinctUntilChanged()
        )
      ),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    desiredUid$
      .pipe(
        tap((uid) => this.dbg('desiredUid(presence) ->', { uid })),

        switchMap((uid) => {
          if (!uid) return this.safeStop$().pipe(take(1));
          return this.safeStart$(uid).pipe(take(1));
        }),

        catchError((err) => {
          this.handleStreamError(err, 'PresenceOrchestrator stream error');
          return of(void 0);
        }),

        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  // ---------------------------------------------------------------------------
  // Helpers seguros
  // ---------------------------------------------------------------------------

  private safeStart$(uid: string) {
    return defer(() => {
      try {
        this.presence.start(uid);
        return of(void 0);
      } catch (err) {
        this.handleStreamError(err, 'PresenceOrchestrator start error');
        return of(void 0);
      }
    });
  }

  private safeStop$() {
    return defer(() => {
      try {
        return this.presence.stop$().pipe(
          catchError((err) => {
            this.handleStreamError(err, 'PresenceOrchestrator stop error');
            return of(void 0);
          })
        );
      } catch (err) {
        this.handleStreamError(err, 'PresenceOrchestrator stop error');
        return of(void 0);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Erro centralizado + notificação com throttle
  // ---------------------------------------------------------------------------

  private handleStreamError(err: unknown, context: string): void {
    try {
      this.applicationError.report(err, {
        feature: 'presence',
        operation: 'orchestratePresence',
        fallbackMessage: 'Falha ao atualizar presença.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'PresenceOrchestratorService',
          context,
        },
      });
    } catch {
      // Presença é best-effort; falha de diagnóstico não interrompe a sessão.
    }

    const now = Date.now();
    if (now - this.lastNotifyAt > 20_000) {
      this.lastNotifyAt = now;
      this.notify.showError?.(
        'Falha ao atualizar presença. Algumas funções em tempo real podem ficar indisponíveis.'
      );
    }
  }

  /**
 * Debug seguro da orquestração de presença.
 *
 * Canal:
 * localStorage.setItem('DEBUG_PRESENCE', '1');
 *
 * Este service decide quando a presença deve iniciar/parar.
 * Isso revela UID, sessão ativa e estado operacional do usuário.
 * Por isso, não deve usar console.log direto.
 */
private dbg(msg: string, extra?: unknown): void {
  this.privacyDebug.log('presence', `PresenceOrchestrator: ${msg}`, extra);
}
}// linha 175, fim do PresenceOrchestratorService
// - O PresenceOrchestratorService é responsável por iniciar e parar o PresenceService de forma idempotente, reagindo a mudanças no estado de acesso do usuário (canRunPresence$ e authUid$). Ele também centraliza o tratamento de erros e notificação para falhas relacionadas à presença.
// - Ele deve ser iniciado preferencialmente no AppComponent para garantir que a presença seja gerenciada durante todo o ciclo de vida do app, mas pode ser chamado em outros lugares desde que seja garantido que start() seja chamado apenas uma vez.


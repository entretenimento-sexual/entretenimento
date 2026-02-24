// src/app/core/services/presence/presence-orchestrator.service.ts
// =============================================================================
// PRESENCE ORCHESTRATOR
//
// Responsabilidade:
// - Consumir SOMENTE gates canônicos do AccessControlService (fonte única).
// - Iniciar/parar PresenceService de forma idempotente e determinística.
// - Não duplicar "verdades" (ready$, uid$, router, inReg) aqui.
//
// Gate usado aqui (OPÇÃO A — recomendado no seu caso):
// - access.canRunInfraRealtime$
//   => roda somente em “modo app” (fora de /register e /login)
//   => não exige emailVerified/profileEligible
//
// Motivação (produto):
// - Durante /register o usuário ainda não está “habilitado” no app.
// - Evita writes de presença prematuros e ruído (permission-denied / logs / custo).
// =============================================================================

import { DestroyRef, Injectable, inject } from '@angular/core';
import { combineLatest, defer, of } from 'rxjs';
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
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { PresenceService } from './presence.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class PresenceOrchestratorService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly debug = !environment.production;

  /** Evita start duplicado (idempotência) */
  private started = false;

  /** Throttle de notificação (evita spam em streams) */
  private lastNotifyAt = 0;

  constructor(
    private readonly access: AccessControlService,
    private readonly presence: PresenceService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notify: ErrorNotificationService,
  ) { }

  /**
   * Inicia o orquestrador de presença.
   * - Idempotente: chamar várias vezes não duplica streams.
   * - Ideal: chamar 1 vez no AppComponent (ou num bootstrap service).
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    /**
     * ✅ Gate canônico (fonte única):
     * OPÇÃO A:
     * - canRunInfraRealtime$ já considera:
     *   - canRunApp$ (routerReady + !blocked)
     *   - ready (Auth restaurado)
     *   - uid presente
     *   - fora do fluxo sensível (/register e /login)
     *
     * Resultado:
     * - Se gate=false => STOP (cleanup)
     * - Se gate=true  => START
     */
    const can$ = this.access.canRunPresence$.pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    /**
     * ✅ UID canônico (AuthSession manda no UID).
     * Observação:
     * - mesmo que can$ já garanta uid presente, mantemos uid$ aqui
     *   para tornar STOP determinístico em edge-cases (race/transição).
     */
    const uid$ = this.access.authUid$.pipe(
      map((uid) => (uid ?? '').trim() || null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    /**
     * Gate final reage a QUALQUER mudança em (can, uid):
     * - can=false ou uid=null => STOP
     * - can=true  e uid!=null => START
     */
    const gate$ = combineLatest([can$, uid$]).pipe(
      map(([can, uid]) => ({ canStart: can === true && !!uid, uid })),
      distinctUntilChanged((a, b) => a.canStart === b.canStart && a.uid === b.uid),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    gate$
      .pipe(
        tap((g) => this.dbg('gate(presence) ->', g)),

        switchMap(({ canStart, uid }) => {
          if (!canStart || !uid) {
            // STOP sempre best-effort
            return this.safeStop$().pipe(take(1));
          }
          // START sempre best-effort
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
  // Helpers seguros (Observable-first)
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
        // stop$ já é Observable no seu design
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
    const e = err instanceof Error ? err : new Error(context);
    (e as any).silent = true; // stream interno; reduz ruído de UX no handler global
    (e as any).original = err;
    (e as any).context = context;

    this.globalError.handleError(e);

    // Notificação opcional e controlada (sem spam)
    const now = Date.now();
    if (now - this.lastNotifyAt > 20_000) {
      this.lastNotifyAt = now;
      this.notify.showError?.(
        'Falha ao atualizar presença. Algumas funções em tempo real podem ficar indisponíveis.'
      );
    }
  }

  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[PresenceOrchestrator] ${msg}`, extra ?? '');
  }
} // linha 191, fim do PresenceOrchestratorService


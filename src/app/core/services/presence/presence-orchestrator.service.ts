// src/app/core/services/presence/presence-orchestrator.service.ts
// Serviço orquestrador para gerenciar a presença do usuário
// - Garante: só 1 aba (líder) mantém presença ativa
// - Observable-first (sem async solto)
// - Erros: best-effort (presença não derruba app)
// Não esquecer os comentários
import { DestroyRef, Injectable, inject } from '@angular/core';
import { fromEvent, combineLatest, defer, from, merge, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
  switchMap,
  tap,
  take,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { PresenceService } from './presence.service';
import { PresenceLeaderElectionService } from './presence-leader-election.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class PresenceOrchestratorService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly debug = !environment.production;

  /** Evita start duplicado (idempotência) */
  private started = false;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly presence: PresenceService,
    private readonly leaderElection: PresenceLeaderElectionService,
    private readonly globalError: GlobalErrorHandlerService,
  ) { }

  /**
   * Inicia o orquestrador de presença.
   * - Idempotente: chamar várias vezes não duplica streams.
   * - Ideal: chamar no AppComponent/AuthOrchestrator.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Gate de prontidão do AuthSession (mantém seu comportamento atual)
    // Gate de prontidão do AuthSession
    const ready$ = defer(() => from(this.authSession.whenReady())).pipe(
      map(() => true),
      startWith(false),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // UID normalizado
    const uid$ = this.authSession.uid$.pipe(
      map((uid) => (uid ?? '').trim() || null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    /**
     * ✅ Gate nível 1:
     * - ready === true
     * - uid != null
     *
     * Aqui NÃO calcula isLeader$.
     * Quem resolve multi-aba é o PresenceService.
     */
    combineLatest([ready$, uid$]).pipe(
      filter(([ready]) => ready === true),
      map(([, uid]) => uid),
      distinctUntilChanged(),
      tap((uid) => this.dbg('gate(level1) ->', { uid })),

      switchMap((uid) => {
        if (!uid) return this.safeStop$();
        return this.safeStart$(uid).pipe(take(1));
      }),

      catchError((err) => {
        this.globalError.handleError(err instanceof Error ? err : new Error('PresenceOrchestrator stream error'));
        return of(void 0);
      }),

      takeUntilDestroyed(this.destroyRef),
    ).subscribe();
  }

  // ===========================================================================
  // Helpers seguros (mantêm Observable + centralização de erro)
  // ===========================================================================

  private safeStart$(uid: string) {
    return defer(() => {
      try {
        this.presence.start(uid);
        return of(void 0);
      } catch (err) {
        const e = err instanceof Error ? err : new Error('PresenceOrchestrator start error');
        this.globalError.handleError(e);
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
            const e = err instanceof Error ? err : new Error('PresenceOrchestrator stop error');
            this.globalError.handleError(e);
            return of(void 0);
          })
        );
      } catch (err) {
        const e = err instanceof Error ? err : new Error('PresenceOrchestrator stop error');
        this.globalError.handleError(e);
        return of(void 0);
      }
    });
  }

  private dbg(msg: string, extra?: unknown) {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[PresenceOrchestrator] ${msg}`, extra ?? '');
  }
} //Linha 136 - fim do PresenceOrchestratorService

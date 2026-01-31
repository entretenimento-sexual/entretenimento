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
    const ready$ = defer(() => from(this.authSession.whenReady())).pipe(
      map(() => true),
      startWith(false),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // UID normalizado para "string | null"
    const uid$ = this.authSession.uid$.pipe(
      map((uid) => (uid ?? '').trim() || null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    /**
     * Stream de storage events (multi-tab).
     * Se você já tiver isso no presence-dom-streams.service.ts, prefira reutilizar de lá.
     */
    const storage$: Observable<StorageEvent> =
      (typeof window !== 'undefined')
        ? fromEvent<StorageEvent>(window, 'storage')
        : of(); // SSR-safe

    /**
     * Stream de liderança por UID.
     * - uid null => isLeader false
     * - uid válido => leaderElection.createIsLeader$
     */
    const isLeader$ = uid$.pipe(
      switchMap((uid) => {
        if (!uid) return of(false);
        return this.leaderElection.createIsLeader$(uid, storage$).pipe(
          startWith(false)
        );
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    /**
     * Nível final:
     * - ready precisa ser true
     * - uid precisa existir
     * - precisa ser líder
     *
     * Se perder liderança ou uid mudar: stop$() é chamado (best-effort).
     */
    combineLatest([ready$, uid$, isLeader$]).pipe(
      filter(([ready]) => ready === true),

      tap(([_, uid, isLeader]) => this.dbg('gate(level2) ->', { uid, isLeader })),

      switchMap(([_, uid, isLeader]) => {
        // Sempre que não atender condições: parar presença
        if (!uid || !isLeader) {
          return this.safeStop$();
        }

        // Condição OK: start presença
        // Se presence.start for void, encapsula em Observable para manter reatividade.
        return this.safeStart$(uid).pipe(
          // Enquanto líder, mantém stream vivo.
          // Se sua PresenceService já mantém listeners internos, aqui pode emitir void e completar.
          take(1),
          switchMap(() => of(void 0)),
          catchError((err) => {
            this.globalError.handleError(err instanceof Error ? err : new Error('Presence start stream error'));
            return of(void 0);
          })
        );
      }),

      // Best-effort global: presença nunca derruba app
      catchError((err) => {
        this.globalError.handleError(err instanceof Error ? err : new Error('PresenceOrchestrator stream error'));
        return of(void 0);
      }),

      takeUntilDestroyed(this.destroyRef),
    ).subscribe();

    /**
     * Cleanup adicional (recomendado):
     * - ao fechar aba, tenta parar presença e liberar liderança.
     * Se você já tem isso no presence-dom-streams.service.ts, mova para lá.
     */
    if (typeof window !== 'undefined') {
      merge(
        fromEvent(window, 'beforeunload'),
        fromEvent(window, 'pagehide')
      ).pipe(
        take(1),
        tap(() => {
          // best-effort sync
          try { this.leaderElection.releaseLeadership(); } catch { }
          // best-effort async
          this.safeStop$().pipe(take(1)).subscribe();
        }),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe();
    }
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
} //Linha 196

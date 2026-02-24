// src/app/core/services/presence/presence.service.ts
// Serviço de presença do usuário
// - Escreve presença no Firestore (online/away/offline, lastSeen)
// - Multi-aba: só 1 aba (líder) mantém presença ativa, evita “falso offline”
// - Escuta eventos de DOM (visibility, online/offline, unload) e traduz em writes
// - Erros são best-effort (não derrubam app; logados no GlobalErrorHandler)
// Não esquecer os comentários explicativos, especialmente sobre a lógica de multi-aba e a relação com o PresenceOrchestratorService. Isso ajuda a contextualizar as decisões de design e a evitar confusões futuras sobre onde e como o status online deve ser controlado e lido.
// Não esquecer comentários e ferramentas de debug
import { Injectable, NgZone } from '@angular/core';
import { EMPTY, Observable, Subscription, combineLatest, interval, merge, of } from 'rxjs';
import {
  auditTime,
  catchError,
  defaultIfEmpty,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  map,
  shareReplay,
  skip,
  startWith,
  switchMap,
  take,
  tap,
  pairwise,
} from 'rxjs/operators';

import { PresenceDomStreamsService } from './presence-dom-streams.service';
import { PresenceLeaderElectionService } from './presence-leader-election.service';
import { PresenceWriterService } from './presence-writer.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class PresenceService {
  private static readonly HEARTBEAT_MS = 30_000;

  /**
   * Recomendo FALSE:
   * - evita “falso offline” em multi-aba (líder fecha e outra aba reassume)
   * - unload/pagehide não garante completar write
   * Offline “real” fica no logout/stop$().
   */
  private static readonly SET_OFFLINE_ON_EXIT = false;

  private readonly debug = !environment.production;

  private sub = new Subscription();
  private activeUid?: string;
  private leaderKey?: string;

  constructor(
    private readonly zone: NgZone,
    private readonly domStreams: PresenceDomStreamsService,
    private readonly leader: PresenceLeaderElectionService,
    private readonly writer: PresenceWriterService
  ) { }

  // ---------------------------------------------------------
  // Debug helper (não polui prod)
  // ---------------------------------------------------------
  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[PresenceService] ${msg}`, extra ?? '');
  }

  start(uid: string): void {
    const cleanUid = (uid ?? '').trim();
    if (!cleanUid) return;

    if (this.activeUid === cleanUid) {
      this.dbg('start ignorado (já ativo)', { uid: cleanUid });
      return;
    }

    if (this.activeUid && this.activeUid !== cleanUid) {
      this.dbg('start com uid diferente → stop anterior', { from: this.activeUid, to: cleanUid });
      this.stop();
    }

    this.activeUid = cleanUid;
    this.leaderKey = this.leader.buildLeaderKey(cleanUid);

    this.dbg('START', { uid: cleanUid, leaderKey: this.leaderKey });

    const dom = this.domStreams.create();

    // createIsLeader$ já tem shareReplay(refCount) internamente
    const isLeader$ = this.leader.createIsLeader$(cleanUid, dom.storage$).pipe(
      distinctUntilChanged(),
      tap((isLeader) => this.dbg('isLeader$', { uid: cleanUid, isLeader })),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // visibilidade com estado inicial (e replay pra evitar múltiplos subscriptions)
    const initialVis: 'hidden' | 'visible' =
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? 'hidden'
        : 'visible';

    const visibility$ = dom.visibility$.pipe(
      startWith(initialVis),
      distinctUntilChanged(),
      tap((v) => this.dbg('visibility$', { uid: cleanUid, v })),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // 1) bootstrap: líder + visibilidade inicial => estado correto (online/away)
    const bootstrap$ = combineLatest([
      isLeader$.pipe(take(1)),
      visibility$.pipe(take(1)),
    ]).pipe(
      filter(([leader]) => leader),
      exhaustMap(([, vis]) =>
        vis === 'hidden'
          ? this.writer.setAway$(cleanUid)
          : this.writer.setOnline$(cleanUid)
      ),
      catchError((err) => {
        // Writer já faz routing centralizado, aqui só evitamos quebrar stream
        this.dbg('bootstrap$ erro (suprimido no stream)', err);
        return EMPTY;
      })
    );

    // 1.1) leader acquired: quando uma aba vira líder (false -> true), escreve estado correto
    // - cobre o caso: aba reassume liderança enquanto já está hidden (sem visibilitychange)
    const onLeaderAcquired$ = isLeader$.pipe(
      startWith(false),
      pairwise(),
      filter(([prev, curr]) => !prev && curr),
      tap(() => this.dbg('leader acquired', { uid: cleanUid })),
      switchMap(() =>
        visibility$.pipe(
          take(1),
          exhaustMap((vis) => {
            const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

            if (offline) {
              return this.writer.setOffline$(cleanUid, 'leader-acquired:navigator-offline');
            }

            return vis === 'hidden'
              ? this.writer.setAway$(cleanUid)
              : this.writer.setOnline$(cleanUid);
          })
        )
      ),
      catchError((err) => {
        this.dbg('onLeaderAcquired$ erro (suprimido no stream)', err);
        return EMPTY;
      })
    );

    // 2) heartbeat SOMENTE quando líder + visible
    const heartbeat$ = combineLatest([isLeader$, visibility$]).pipe(
      switchMap(([leader, vis]) => {
        if (!leader || vis !== 'visible') return EMPTY;

        return interval(PresenceService.HEARTBEAT_MS).pipe(
          startWith(0),
          filter(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)),
          exhaustMap(() => this.writer.beatOnline$(cleanUid)),
          catchError((err) => {
            this.dbg('heartbeat$ erro (suprimido no stream)', err);
            return EMPTY;
          })
        );
      })
    );

    // 3) rede voltou: líder seta online/away conforme visibilidade atual
    const onOnline$ = dom.online$.pipe(
      auditTime(1000),
      tap(() => this.dbg('DOM online$', { uid: cleanUid })),
      switchMap(() =>
        combineLatest([isLeader$.pipe(take(1)), visibility$.pipe(take(1))]).pipe(
          filter(([leader]) => leader),
          exhaustMap(([, vis]) =>
            vis === 'hidden'
              ? this.writer.setAway$(cleanUid)
              : this.writer.setOnline$(cleanUid)
          )
        )
      ),
      catchError((err) => {
        this.dbg('onOnline$ erro (suprimido no stream)', err);
        return EMPTY;
      })
    );

    // 4) visibilidade mudou: líder seta away/online (não usa beatOnline$ aqui)
    const onVisibility$ = visibility$.pipe(
      skip(1),
      switchMap((state) =>
        isLeader$.pipe(
          take(1),
          filter(Boolean),
          exhaustMap(() =>
            state === 'hidden'
              ? this.writer.setAway$(cleanUid)
              : this.writer.setOnline$(cleanUid)
          )
        )
      ),
      catchError((err) => {
        this.dbg('onVisibility$ erro (suprimido no stream)', err);
        return EMPTY;
      })
    );

    // 5) rede caiu: líder tenta setOffline (best-effort)
    const onOffline$ = dom.offline$.pipe(
      auditTime(250),
      tap((reason) => this.dbg('DOM offline$', { uid: cleanUid, reason })),
      switchMap((reason) =>
        isLeader$.pipe(
          take(1),
          filter(Boolean),
          exhaustMap(() => this.writer.setOffline$(cleanUid, reason))
        )
      ),
      catchError((err) => {
        this.dbg('onOffline$ erro (suprimido no stream)', err);
        return EMPTY;
      })
    );

    // 6) exit: libera liderança imediatamente (sincrono); opcionalmente tenta setOffline
    const onExit$ = merge(dom.beforeUnload$, dom.pageHide$).pipe(
      auditTime(50),
      map((reason) => ({
        reason,
        wasLeader: this.leader.isLeaderNow(cleanUid),
        key: this.leaderKey,
      })),
      tap(({ wasLeader, key }) => {
        // libera para outra aba reassumir sem esperar TTL
        if (wasLeader && key) {
          this.dbg('EXIT: releaseLeadership()', { uid: cleanUid, key });
          this.leader.releaseLeadership(key);
        }
      }),
      switchMap(({ reason, wasLeader }) => {
        if (!PresenceService.SET_OFFLINE_ON_EXIT) return EMPTY;
        if (!wasLeader) return EMPTY;
        return this.writer.setOffline$(cleanUid, reason);
      }),
      catchError((err) => {
        this.dbg('onExit$ erro (suprimido no stream)', err);
        return EMPTY;
      })
    );

    this.zone.runOutsideAngular(() => {
      this.sub.add(bootstrap$.subscribe());
      this.sub.add(onLeaderAcquired$.subscribe());
      this.sub.add(heartbeat$.subscribe());
      this.sub.add(onOnline$.subscribe());
      this.sub.add(onVisibility$.subscribe());
      this.sub.add(onOffline$.subscribe());
      this.sub.add(onExit$.subscribe());
    });
  }

  stop$(): Observable<void> {
    if (!this.activeUid) return of(void 0);

    const uid = this.activeUid;
    const key = this.leaderKey;

    // Para imediatamente todos os streams (evita beatOnline concorrente)
    this.sub.unsubscribe();
    this.sub = new Subscription();

    this.activeUid = undefined;
    this.leaderKey = undefined;

    const wasLeader = !!uid && this.leader.isLeaderNow(uid);

    this.dbg('STOP$', { uid: uid ?? null, wasLeader });

    const markOffline$ =
      wasLeader && uid
        ? this.writer.setOffline$(uid, 'stop$()').pipe(
          defaultIfEmpty(void 0),
          catchError(() => of(void 0)) // writer já roteia erros; aqui é só “não travar stop$”
        )
        : of(void 0);

    return markOffline$.pipe(
      finalize(() => {
        // release liderança (idempotente e safe)
        if (wasLeader && key) {
          this.dbg('STOP$: releaseLeadership()', { key });
          this.leader.releaseLeadership(key);
        }
      }),
      map(() => void 0)
    );
  }

  stop(): void {
    this.stop$().pipe(take(1)).subscribe({ next: () => { }, error: () => { } });
  }
} // 268 linhas, parece estar no limite.
// ***** Sempre considerar que existe no projeto o user-presence.query.service.ts *****
// ***** Sempre considerar que existe no projeto o user-discovery.query.service.ts
// ***** Sempre considerar que existe o presence\presence-dom-streams.service.ts *****
// src/app/core/services/presence/presence-orchestrator.service.ts
// ***** Sempre considerar que existe o data-handling/firestore-user-write.service.ts *****
// ***** Sempre considerar que existe o data-handling/firestore-user-query.service.ts *****
// ***** Sempre considerar que existe o data-handling/queries/user-discovery.query.service.ts *****
// ***** Sempre considerar que existe o data-handling/queries/user-presence.query.service.ts *****
// ***** Sempre considerar que existe o autentication/auth/current-user-store.service.ts *****
/**
 * =============================================================================
 * PRESENCE SERVICE (Write / plataforma)
 * - Implementa presença do usuário no Firestore: heartbeat, lastSeen, presenceState.
 * - Resolve multi-aba via leader election (evita N abas escrevendo ao mesmo tempo).
 * - Escuta eventos de DOM (online/offline, visibility, unload) e traduz em writes.
 *
 * Entradas:
 * - start(uid) e stop() (UID sempre vem do AuthOrchestrator/AuthSession).
 *
 * NÃO faz:
 * - NÃO decide “se deve rodar” (isso é do AuthOrchestrator).
 * - NÃO depende de Router, NgRx, nem UI.
 *
 * Erros:
 * - Presença não derruba a app; erros são silent e passam no GlobalErrorHandler.
 * =============================================================================
 *
 * 1) Gate “tipo plataforma grande”: 2 níveis (não 1)

Nível 1 — Presence Gate (mínimo)

ready === true + uid != null
não depende de emailVerified
Objetivo: presença “infra” (telemetria de sessão) e coisas neutras.

Nível 2 — Realtime Features Gate (produto)

ready === true + uid != null + emailVerified === true (e/ou profileCompleted)
Objetivo: chat/discovery/online-users/listeners que expõem o usuário para outros.
Isso elimina a contradição do log:

OnlineUsersEffects canStart:false (nível 2)

PresenceService START (nível 1)

Isso é exatamente como plataformas grandes fazem: infra/telemetria não precisa ser travada por “verificação”.
 */


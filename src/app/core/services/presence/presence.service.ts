// src/app/core/services/presence/presence.service.ts
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
} from 'rxjs/operators';

import { PresenceDomStreamsService } from './presence-dom-streams.service';
import { PresenceLeaderElectionService } from './presence-leader-election.service';
import { PresenceWriterService } from './presence-writer.service';

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

  private sub = new Subscription();
  private activeUid?: string;
  private leaderKey?: string;

  constructor(
    private readonly zone: NgZone,
    private readonly domStreams: PresenceDomStreamsService,
    private readonly leader: PresenceLeaderElectionService,
    private readonly writer: PresenceWriterService
  ) { }

  start(uid: string): void {
    const cleanUid = (uid ?? '').trim();
    if (!cleanUid) return;

    if (this.activeUid === cleanUid) return;
    if (this.activeUid && this.activeUid !== cleanUid) this.stop();

    this.activeUid = cleanUid;
    this.leaderKey = this.leader.buildLeaderKey(cleanUid);

    const dom = this.domStreams.create();

    // createIsLeader$ já tem shareReplay(refCount) internamente
    const isLeader$ = this.leader.createIsLeader$(cleanUid, dom.storage$);

    // visibilidade com estado inicial (e replay pra evitar múltiplos subscriptions)
    const initialVis: 'hidden' | 'visible' =
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? 'hidden'
        : 'visible';

    const visibility$ = dom.visibility$.pipe(
      startWith(initialVis),
      distinctUntilChanged(),
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
      )
    );

    // 2) heartbeat SOMENTE quando líder + visible
    const heartbeat$ = combineLatest([isLeader$, visibility$]).pipe(
      switchMap(([leader, vis]) => {
        if (!leader || vis !== 'visible') return EMPTY;

        return interval(PresenceService.HEARTBEAT_MS).pipe(
          startWith(0),
          filter(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)),
          exhaustMap(() => this.writer.beatOnline$(cleanUid))
        );
      })
    );

    // 3) rede voltou: líder seta online/away conforme visibilidade atual
    const onOnline$ = dom.online$.pipe(
      auditTime(1000),
      switchMap(() =>
        combineLatest([isLeader$.pipe(take(1)), visibility$.pipe(take(1))]).pipe(
          filter(([leader]) => leader),
          exhaustMap(([, vis]) =>
            vis === 'hidden'
              ? this.writer.setAway$(cleanUid)
              : this.writer.setOnline$(cleanUid)
          )
        )
      )
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
      )
    );

    // 5) rede caiu: líder tenta setOffline (best-effort)
    const onOffline$ = dom.offline$.pipe(
      auditTime(250),
      switchMap((reason) =>
        isLeader$.pipe(
          take(1),
          filter(Boolean),
          exhaustMap(() => this.writer.setOffline$(cleanUid, reason))
        )
      )
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
        if (wasLeader) this.leader.releaseLeadership(key);
      }),
      switchMap(({ reason, wasLeader }) => {
        if (!PresenceService.SET_OFFLINE_ON_EXIT) return EMPTY;
        if (!wasLeader) return EMPTY;
        return this.writer.setOffline$(cleanUid, reason);
      })
    );

    this.zone.runOutsideAngular(() => {
      this.sub.add(bootstrap$.subscribe());
      this.sub.add(heartbeat$.subscribe());
      this.sub.add(onOnline$.subscribe());
      this.sub.add(onVisibility$.subscribe());
      this.sub.add(onOffline$.subscribe());
      this.sub.add(onExit$.subscribe());
    });
  }

  stop$(): Observable<void> {
    const uid = this.activeUid;
    const key = this.leaderKey;

    this.sub.unsubscribe();
    this.sub = new Subscription();
    this.activeUid = undefined;
    this.leaderKey = undefined;

    const wasLeader = !!uid && this.leader.isLeaderNow(uid);

    const markOffline$ =
      wasLeader && uid
        ? this.writer.setOffline$(uid, 'stop$()').pipe(
          defaultIfEmpty(void 0),
          catchError(() => of(void 0))
        )
        : of(void 0);

    return markOffline$.pipe(
      finalize(() => {
        if (wasLeader) this.leader.releaseLeadership(key);
      }),
      map(() => void 0)
    );
  }

  stop(): void {
    this.stop$().pipe(take(1)).subscribe({ next: () => { }, error: () => { } });
  }
}
// 203 linhas, parece estar no limite, mas ok.
// ***** Sempre considerar que existe no projeto o user-presence.query.service.ts *****
// ***** Sempre considerar que existe no projeto o user-discovery.query.service.ts
// ***** Sempre considerar que existe o presence\presence-dom-streams.service.ts *****
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
 */


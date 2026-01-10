// src/app/core/services/autentication/auth/presence.service.ts
import { Injectable, NgZone } from '@angular/core';
import {
  Firestore,
  doc,
  updateDoc,
  setDoc,
  serverTimestamp as afServerTimestamp,
} from '@angular/fire/firestore';
import { EMPTY, Observable, Subscription, fromEvent, interval, merge, of } from 'rxjs';
import {
  auditTime,
  catchError,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
} from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

type PresenceState = 'online' | 'away' | 'offline';

type LeaderPayload = {
  tabId: string;
  expiresAt: number; // ms
};

type DomStreams = {
  beforeUnload$: Observable<'beforeunload'>;
  pageHide$: Observable<'pagehide'>;
  offline$: Observable<'offline'>;
  online$: Observable<'online'>;
  visibility$: Observable<'hidden' | 'visible'>;
  storageLeaderChange$: Observable<boolean>;
};

@Injectable({ providedIn: 'root' })
export class PresenceService {
  /**
   * Compatibilidade:
   * enquanto a app usa where('isOnline','==',true), mantemos este campo.
   */
  private static readonly KEEP_ISONLINE_COMPAT = true;

  // “produção-friendly”
  private static readonly HEARTBEAT_MS = 30_000;
  private static readonly LEADER_TTL_MS = 15_000;
  private static readonly LEADER_RENEW_MS = 5_000;

  private sub = new Subscription();
  private activeUid?: string;

  private readonly tabId = this.createTabId();
  private leaderKey?: string;

  constructor(
    private readonly db: Firestore,
    private readonly zone: NgZone,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) { }

  /* =======================================================================
     Public API
     ======================================================================= */

  start(uid: string): void {
    const cleanUid = (uid ?? '').trim();
    if (!cleanUid) return;

    // idempotente
    if (this.activeUid === cleanUid) return;

    // se estava rodando para outro uid, encerra
    if (this.activeUid && this.activeUid !== cleanUid) this.stop();

    this.activeUid = cleanUid;
    this.leaderKey = this.buildLeaderKey(cleanUid);

    const dom = this.createDomStreams(cleanUid);
    const isLeader$ = this.createLeaderStream(cleanUid, dom.storageLeaderChange$);

    const writeBeat$ = () => this.writePresence$(cleanUid, 'online', {});
    const writeAway$ = () => this.writePresence$(cleanUid, 'away', {});
    const writeOffline$ = (reason: string) =>
      this.writePresence$(cleanUid, 'offline', {
        ...(PresenceService.KEEP_ISONLINE_COMPAT ? { isOnline: false } : null),
        lastOfflineAt: afServerTimestamp(),
        lastOfflineReason: reason,
      });

    // 1) batida inicial rápida
    const initial$ = isLeader$.pipe(
      take(1),
      filter(Boolean),
      exhaustMap(() => writeBeat$())
    );

    // 2) heartbeat periódico (somente líder)
    const heartbeat$ = isLeader$.pipe(
      switchMap((leader) =>
        leader
          ? interval(PresenceService.HEARTBEAT_MS).pipe(
            startWith(0),
            filter(() =>
              typeof navigator === 'undefined' ? true : navigator.onLine !== false
            ),
            exhaustMap(() => writeBeat$())
          )
          : EMPTY
      )
    );

    // 3) voltei online (rede)
    const onOnline$ = dom.online$.pipe(
      auditTime(1000),
      switchMap(() =>
        isLeader$.pipe(
          take(1),
          filter(Boolean),
          exhaustMap(() =>
            this.writePresence$(cleanUid, 'online', {
              lastOnlineAt: afServerTimestamp(),
            })
          )
        )
      )
    );

    // 4) visibilidade (aba escondida -> away)
    const onVisibility$ = dom.visibility$.pipe(
      switchMap((state) =>
        isLeader$.pipe(
          take(1),
          filter(Boolean),
          exhaustMap(() => (state === 'hidden' ? writeAway$() : writeBeat$()))
        )
      )
    );

    // 5) encerramento best-effort (somente líder)
    const onExit$ = merge(dom.beforeUnload$, dom.pageHide$, dom.offline$).pipe(
      auditTime(250),
      switchMap((reason) =>
        isLeader$.pipe(
          take(1),
          filter(Boolean),
          exhaustMap(() => writeOffline$(reason))
        )
      )
    );

    // Subscriptions fora da zone (não “chacoalha” CD)
    this.zone.runOutsideAngular(() => {
      this.sub.add(initial$.subscribe());
      this.sub.add(heartbeat$.subscribe());
      this.sub.add(onOnline$.subscribe());
      this.sub.add(onVisibility$.subscribe());
      this.sub.add(onExit$.subscribe());
    });
  }

  stop(): void {
    const uid = this.activeUid;
    const key = this.leaderKey;

    this.sub.unsubscribe();
    this.sub = new Subscription();

    // best-effort: se eu era líder, marco offline e libero liderança
    if (uid && this.isLeaderNow(uid)) {
      this.writePresence$(uid, 'offline', {
        ...(PresenceService.KEEP_ISONLINE_COMPAT ? { isOnline: false } : null),
        lastOfflineAt: afServerTimestamp(),
        lastOfflineReason: 'stop()',
      })
        .pipe(take(1))
        .subscribe({ next: () => { }, error: () => { } });

      this.releaseLeadership(key);
    }

    this.activeUid = undefined;
    this.leaderKey = undefined;
  }

  /* =======================================================================
     Firestore write core (robusto: trata NOT_FOUND)
     ======================================================================= */

  private writePresence$(
    uid: string,
    state: PresenceState,
    extra: Record<string, unknown>
  ): Observable<void> {
    const payload: Record<string, unknown> = {
      lastSeen: afServerTimestamp(),
      presenceState: state,
      presenceSessionId: this.tabId,
      ...(PresenceService.KEEP_ISONLINE_COMPAT ? { isOnline: state !== 'offline' } : null),
      ...extra,
    };

    return this.ctx
      .deferPromise$(async () => {
        const ref = doc(this.db, 'users', uid);

        try {
          await updateDoc(ref, payload as any);
          return;
        } catch (err: any) {
          // Se o doc não existir, semeia e tenta de novo (padrão robusto)
          if (this.isNotFound(err)) {
            await setDoc(
              ref,
              {
                uid,
                createdAt: afServerTimestamp(),
                ...payload,
              } as any,
              { merge: true }
            );
            return;
          }
          throw err;
        }
      })
      .pipe(
        map(() => void 0),
        catchError((err) => {
          // Presença NÃO derruba a app
          this.reportPresenceError(err, { uid, state, payload });
          return EMPTY;
        })
      );
  }

  private isNotFound(err: any): boolean {
    const code = err?.code ?? err?.message ?? '';
    return String(code).includes('not-found') || String(code).includes('NOT_FOUND');
  }

  /* =======================================================================
     DOM streams / leader election (multi-aba)
     ======================================================================= */

  private createDomStreams(uid: string): DomStreams {
    const hasWindow = typeof window !== 'undefined';
    const hasDoc = typeof document !== 'undefined';

    const beforeUnload$ = hasWindow
      ? fromEvent(window, 'beforeunload').pipe(map(() => 'beforeunload' as const))
      : EMPTY;

    const pageHide$ = hasWindow
      ? fromEvent(window, 'pagehide').pipe(map(() => 'pagehide' as const))
      : EMPTY;

    const offline$ = hasWindow
      ? fromEvent(window, 'offline').pipe(map(() => 'offline' as const))
      : EMPTY;

    const online$ = hasWindow
      ? fromEvent(window, 'online').pipe(map(() => 'online' as const))
      : EMPTY;

    const visibility$ = hasDoc
      ? fromEvent(document, 'visibilitychange').pipe(
        map((): 'hidden' | 'visible' =>
          document.visibilityState === 'hidden' ? 'hidden' : 'visible'
        )
      )
      : EMPTY;

    const storageLeaderChange$ = hasWindow
      ? fromEvent<StorageEvent>(window, 'storage').pipe(
        filter((ev) => !!this.leaderKey && ev.key === this.leaderKey),
        map(() => this.isLeaderNow(uid))
      )
      : EMPTY;

    return {
      beforeUnload$,
      pageHide$,
      offline$,
      online$,
      visibility$,
      storageLeaderChange$,
    };
  }

  private createLeaderStream(
    uid: string,
    storageLeaderChange$: Observable<boolean>
  ): Observable<boolean> {
    const leaderTick$ = interval(PresenceService.LEADER_RENEW_MS).pipe(
      startWith(0),
      map(() => this.tryAcquireLeadership(uid)),
      distinctUntilChanged()
    );

    return merge(leaderTick$, storageLeaderChange$).pipe(
      distinctUntilChanged(),
      // ✅ ESSA é a correção importante: evita interval “vazar” após stop()
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private buildLeaderKey(uid: string): string {
    return `presence_leader:${uid}`;
  }

  private tryAcquireLeadership(uid: string): boolean {
    const key = this.buildLeaderKey(uid);
    this.leaderKey = key;

    // sem localStorage: assume single-tab
    if (typeof window === 'undefined' || !window.localStorage) return true;

    const now = Date.now();
    const ttl = PresenceService.LEADER_TTL_MS;

    try {
      const raw = window.localStorage.getItem(key);
      const current: LeaderPayload | null = raw ? JSON.parse(raw) : null;

      const expired = !current || current.expiresAt <= now;
      const mine = !!current && current.tabId === this.tabId;

      if (expired || mine) {
        const next: LeaderPayload = { tabId: this.tabId, expiresAt: now + ttl };
        window.localStorage.setItem(key, JSON.stringify(next));
        return true;
      }

      return false;
    } catch {
      // localStorage bloqueado: melhor esforço
      return true;
    }
  }

  private isLeaderNow(uid: string): boolean {
    const key = this.buildLeaderKey(uid);
    if (typeof window === 'undefined' || !window.localStorage) return true;

    try {
      const raw = window.localStorage.getItem(key);
      const current: LeaderPayload | null = raw ? JSON.parse(raw) : null;
      if (!current) return false;
      return current.tabId === this.tabId && current.expiresAt > Date.now();
    } catch {
      return true;
    }
  }

  private releaseLeadership(key?: string): void {
    if (!key) return;
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      const raw = window.localStorage.getItem(key);
      const current: LeaderPayload | null = raw ? JSON.parse(raw) : null;
      if (current?.tabId === this.tabId) window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  private createTabId(): string {
    try {
      // @ts-ignore
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null;
      return id || `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    } catch {
      return `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    }
  }

  /* =======================================================================
     Error routing (central)
     ======================================================================= */

  private reportPresenceError(err: any, ctx: any): void {
    // Presença não deve disparar UI/toast: só observabilidade.
    try {
      const e = new Error('[PresenceService] Firestore presence update failed');
      (e as any).silent = true;
      (e as any).original = err;
      (e as any).context = ctx;
      (this.globalErrorHandler as any)?.handleError?.(e);
    } catch {
      // fallback silencioso
    }
  }
} // linha 403. persar em dividir este arquivo
// ***** Sempre considera que existe o auth/presence.service.ts *****

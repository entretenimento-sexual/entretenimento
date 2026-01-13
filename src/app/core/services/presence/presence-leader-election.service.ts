//src\app\core\services\presence\presence-leader-election.service.ts
import { Injectable } from '@angular/core';
import { Observable, interval, merge } from 'rxjs';
import { distinctUntilChanged, filter, map, shareReplay, startWith } from 'rxjs/operators';

type LeaderPayload = {
  tabId: string;
  expiresAt: number; // ms
};

@Injectable({ providedIn: 'root' })
export class PresenceLeaderElectionService {
  // “produção-friendly”
  private static readonly LEADER_TTL_MS = 15_000;
  private static readonly LEADER_RENEW_MS = 5_000;

  private readonly tabId = this.createTabId();
  private leaderKey?: string;

  buildLeaderKey(uid: string): string {
    return `presence_leader:${uid}`;
  }

  /**
   * Stream reativo de liderança:
   * - tick tenta adquirir/renovar
   * - storage reage a mudanças em outras abas
   * - shareReplay(refCount) garante parar interval quando ninguém usa
   */
  createIsLeader$(uid: string, storage$: Observable<StorageEvent>): Observable<boolean> {
    const cleanUid = (uid ?? '').trim();
    const key = this.buildLeaderKey(cleanUid);
    this.leaderKey = key;

    const leaderTick$ = interval(PresenceLeaderElectionService.LEADER_RENEW_MS).pipe(
      startWith(0),
      map(() => this.tryAcquireLeadership(cleanUid)),
      distinctUntilChanged()
    );

    const storageLeaderChange$ = storage$.pipe(
      filter((ev) => ev.key === key),
      map(() => this.isLeaderNow(cleanUid)),
      distinctUntilChanged()
    );

    return merge(leaderTick$, storageLeaderChange$).pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  isLeaderNow(uid: string): boolean {
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

  releaseLeadership(key?: string): void {
    const k = key ?? this.leaderKey;
    if (!k) return;
    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      const raw = window.localStorage.getItem(k);
      const current: LeaderPayload | null = raw ? JSON.parse(raw) : null;
      if (current?.tabId === this.tabId) window.localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }

  private tryAcquireLeadership(uid: string): boolean {
    const key = this.buildLeaderKey(uid);
    this.leaderKey = key;

    if (typeof window === 'undefined' || !window.localStorage) return true;

    const now = Date.now();
    const ttl = PresenceLeaderElectionService.LEADER_TTL_MS;

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
      return true;
    }
  }

  private createTabId(): string {
    try {
      // @ts-ignore
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null;
      return id || `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    } catch {
      return `tab_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    }
  }
}
// ***** Sempre considerar que existe o presence\presence-dom-streams.service.ts *****
// ***** Sempre considerar que existe o data-handling/firestore-user-write.service.ts *****
// ***** Sempre considerar que existe o data-handling/firestore-user-query.service.ts *****
// ***** Sempre considerar que existe o data-handling/queries/user-discovery.query.service.ts *****
// ***** Sempre considerar que existe o data-handling/queries/user-presence.query.service.ts *****
// ***** Sempre considerar que existe o autentication/auth/current-user-store.service.ts *****
// ***** Sempre considerar que existe o presence\presence.service.ts *****

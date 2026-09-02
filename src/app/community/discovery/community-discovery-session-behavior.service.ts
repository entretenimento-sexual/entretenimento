// src/app/community/discovery/community-discovery-session-behavior.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged, map, Observable } from 'rxjs';

export interface CommunityDiscoverySessionSignal {
  readonly meaningfulOpenCount: number;
  readonly lastMeaningfulOpenAt: number | null;
  readonly memberActive: boolean;
}

export interface CommunityDiscoverySessionBehaviorState {
  readonly hiddenCommunityIds: readonly string[];
  readonly signals: Readonly<Record<string, CommunityDiscoverySessionSignal>>;
}

const OPEN_DEDUP_MS = 5 * 60 * 1_000;
const MAX_SESSION_OPENS = 5;
const INITIAL_SIGNAL: CommunityDiscoverySessionSignal = Object.freeze({
  meaningfulOpenCount: 0,
  lastMeaningfulOpenAt: null,
  memberActive: false,
});
const INITIAL_STATE: CommunityDiscoverySessionBehaviorState = Object.freeze({
  hiddenCommunityIds: [],
  signals: Object.freeze({}),
});

function normalizeCommunityId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(normalized) ? normalized : '';
}

@Injectable({ providedIn: 'root' })
export class CommunityDiscoverySessionBehaviorService {
  private readonly stateSubject =
    new BehaviorSubject<CommunityDiscoverySessionBehaviorState>(INITIAL_STATE);

  readonly state$: Observable<CommunityDiscoverySessionBehaviorState> =
    this.stateSubject.asObservable();

  recordMeaningfulOpen(communityId: string, now = Date.now()): void {
    const id = normalizeCommunityId(communityId);
    if (!id) return;

    const state = this.stateSubject.value;
    const current = state.signals[id] ?? INITIAL_SIGNAL;
    if (
      current.lastMeaningfulOpenAt !== null
      && now - current.lastMeaningfulOpenAt < OPEN_DEDUP_MS
    ) {
      return;
    }

    this.patchSignal(id, {
      ...current,
      meaningfulOpenCount: Math.min(
        current.meaningfulOpenCount + 1,
        MAX_SESSION_OPENS
      ),
      lastMeaningfulOpenAt: now,
    });
  }

  setMembershipActive(communityId: string, memberActive: boolean): void {
    const id = normalizeCommunityId(communityId);
    if (!id) return;

    const state = this.stateSubject.value;
    const current = state.signals[id] ?? INITIAL_SIGNAL;
    if (current.memberActive === memberActive) return;

    this.patchSignal(id, { ...current, memberActive });
  }

  hideCommunity(communityId: string): void {
    const id = normalizeCommunityId(communityId);
    if (!id) return;

    const state = this.stateSubject.value;
    if (state.hiddenCommunityIds.includes(id)) return;

    this.stateSubject.next({
      ...state,
      hiddenCommunityIds: [...state.hiddenCommunityIds, id],
    });
  }

  restoreCommunity(communityId: string): void {
    const id = normalizeCommunityId(communityId);
    if (!id) return;

    const state = this.stateSubject.value;
    if (!state.hiddenCommunityIds.includes(id)) return;

    this.stateSubject.next({
      ...state,
      hiddenCommunityIds: state.hiddenCommunityIds.filter(
        (hiddenId) => hiddenId !== id
      ),
    });
  }

  signalFor$(communityId: string): Observable<CommunityDiscoverySessionSignal> {
    const id = normalizeCommunityId(communityId);
    return this.state$.pipe(
      map((state) => state.signals[id] ?? INITIAL_SIGNAL),
      distinctUntilChanged(
        (previous, current) =>
          previous.meaningfulOpenCount === current.meaningfulOpenCount
          && previous.lastMeaningfulOpenAt === current.lastMeaningfulOpenAt
          && previous.memberActive === current.memberActive
      )
    );
  }

  private patchSignal(
    communityId: string,
    signal: CommunityDiscoverySessionSignal
  ): void {
    const state = this.stateSubject.value;
    this.stateSubject.next({
      ...state,
      signals: {
        ...state.signals,
        [communityId]: Object.freeze(signal),
      },
    });
  }
}

// src/app/community/feed/community-feed-cache.testing.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED CACHE TEST DOUBLE
// -----------------------------------------------------------------------------
// Mantém os testes de componente desacoplados da infraestrutura NgRx sem
// enfraquecer o runtime. O double preserva a mesma redução reativa de eventos
// usada pelo cache real; a integração NgRx permanece coberta nos testes do
// reducer/cache.
// -----------------------------------------------------------------------------

import type { Provider } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import type { Observable } from 'rxjs';

import type { CommunityFeedView } from '../data-access/community-feed.model';
import {
  buildCommunityFeedCacheKey,
  buildCommunityFeedCacheQuery,
} from './community-feed-cache.model';
import type { CommunityFeedCacheQuery } from './community-feed-cache.model';
import { CommunityFeedCacheService } from './community-feed-cache.service';
import type { CommunityFeedCacheSnapshot } from './community-feed-cache.service';
import {
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from './community-feed-state.model';
import type {
  CommunityFeedLoadEvent,
  CommunityFeedState,
} from './community-feed-state.model';

class CommunityFeedCacheTestDouble {
  private readonly states = new Map<
    string,
    BehaviorSubject<CommunityFeedState>
  >();

  constructor(private readonly viewerUid: string) {}

  readSnapshot$(
    communityId: string,
    view: CommunityFeedView
  ): Observable<CommunityFeedCacheSnapshot | null> {
    const query = buildCommunityFeedCacheQuery(
      this.viewerUid,
      communityId,
      view
    );
    if (!query) return of(null);

    return of({
      query,
      state: this.stateSubject(query).value,
      lastLoadedAt: 0,
      fresh: false,
      revalidateAfterMs: 0,
    });
  }

  state$(query: CommunityFeedCacheQuery): Observable<CommunityFeedState> {
    return this.stateSubject(query).asObservable();
  }

  applyEvent(
    query: CommunityFeedCacheQuery,
    event: CommunityFeedLoadEvent
  ): void {
    const state = this.stateSubject(query);
    state.next(reduceCommunityFeedState(state.value, event));
  }

  currentQuery(
    communityId: string,
    view: CommunityFeedView
  ): CommunityFeedCacheQuery | null {
    return buildCommunityFeedCacheQuery(this.viewerUid, communityId, view);
  }

  private stateSubject(
    query: CommunityFeedCacheQuery
  ): BehaviorSubject<CommunityFeedState> {
    const key = buildCommunityFeedCacheKey(query);
    let state = this.states.get(key);
    if (!state) {
      state = new BehaviorSubject<CommunityFeedState>(
        INITIAL_COMMUNITY_FEED_STATE
      );
      this.states.set(key, state);
    }
    return state;
  }
}

export function provideCommunityFeedCacheTestDouble(
  viewerUid = 'community-feed-test-viewer'
): Provider {
  return {
    provide: CommunityFeedCacheService,
    useFactory: () => new CommunityFeedCacheTestDouble(viewerUid),
  };
}

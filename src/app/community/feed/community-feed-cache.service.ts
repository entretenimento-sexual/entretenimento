// src/app/community/feed/community-feed-cache.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED CACHE FACADE
// -----------------------------------------------------------------------------
// Isola o componente dos detalhes do NgRx e vincula todo snapshot ao viewer atual.
// Firebase/callables permanecem no repository; este serviço guarda somente estado
// serializável já autorizado e normalizado.
// -----------------------------------------------------------------------------

import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, map, of, switchMap, take } from 'rxjs';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import * as CommunityFeedCacheActions from 'src/app/store/actions/actions.community/community-feed-cache.actions';
import { selectCommunityFeedCacheSlice } from 'src/app/store/selectors/selectors.community/community-feed-cache.selectors';
import type { AppState } from 'src/app/store/states/app.state';
import type { CommunityFeedView } from '../data-access/community-feed.model';
import {
  COMMUNITY_FEED_CACHE_SOFT_TTL_MS,
  CommunityFeedCacheQuery,
  buildCommunityFeedCacheQuery,
  communityFeedCacheAgeMs,
  isCommunityFeedCacheHardExpired,
} from './community-feed-cache.model';
import {
  CommunityFeedLoadEvent,
  CommunityFeedState,
  INITIAL_COMMUNITY_FEED_STATE,
} from './community-feed-state.model';

export interface CommunityFeedCacheSnapshot {
  readonly query: CommunityFeedCacheQuery;
  readonly state: CommunityFeedState;
  readonly fresh: boolean;
  readonly revalidateAfterMs: number;
}

@Injectable({ providedIn: 'root' })
export class CommunityFeedCacheService {
  private readonly store = inject(Store<AppState>);
  private readonly session = inject(AuthSessionService);
  private readonly destroyRef = inject(DestroyRef);
  private activeViewerUid: string | null = null;

  constructor() {
    this.session.readyUid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        const query = buildCommunityFeedCacheQuery(uid, 'placeholder', 'feed');
        const viewerUid = query?.viewerUid ?? null;
        this.activeViewerUid = viewerUid;
        this.store.dispatch(
          CommunityFeedCacheActions.activateCommunityFeedViewer({ viewerUid })
        );
      });
  }

  readSnapshot$(
    communityId: string,
    view: CommunityFeedView
  ): Observable<CommunityFeedCacheSnapshot | null> {
    return this.session.readyUid$.pipe(
      take(1),
      switchMap((uid) => {
        const query = buildCommunityFeedCacheQuery(uid, communityId, view);
        if (!query) return of(null);

        const now = Date.now();
        this.store.dispatch(
          CommunityFeedCacheActions.touchCommunityFeedScope({
            query,
            accessedAt: now,
          })
        );

        return this.store.select(selectCommunityFeedCacheSlice(query)).pipe(
          take(1),
          map((slice): CommunityFeedCacheSnapshot => {
            if (!slice || isCommunityFeedCacheHardExpired(slice.lastLoadedAt, now)) {
              return {
                query,
                state: INITIAL_COMMUNITY_FEED_STATE,
                fresh: false,
                revalidateAfterMs: 0,
              };
            }

            const age = communityFeedCacheAgeMs(slice.lastLoadedAt, now);
            const fresh = age !== null && age < COMMUNITY_FEED_CACHE_SOFT_TTL_MS;

            return {
              query,
              state: slice.state,
              fresh,
              revalidateAfterMs: fresh && age !== null
                ? Math.max(0, COMMUNITY_FEED_CACHE_SOFT_TTL_MS - age)
                : 0,
            };
          })
        );
      })
    );
  }

  state$(query: CommunityFeedCacheQuery): Observable<CommunityFeedState> {
    return this.store.select(selectCommunityFeedCacheSlice(query)).pipe(
      map((slice) => slice?.state ?? INITIAL_COMMUNITY_FEED_STATE)
    );
  }

  applyEvent(query: CommunityFeedCacheQuery, event: CommunityFeedLoadEvent): void {
    this.store.dispatch(
      CommunityFeedCacheActions.applyCommunityFeedEvent({
        query,
        event,
        occurredAt: Date.now(),
      })
    );
  }

  currentQuery(
    communityId: string,
    view: CommunityFeedView
  ): CommunityFeedCacheQuery | null {
    return buildCommunityFeedCacheQuery(
      this.activeViewerUid || this.session.currentAuthUser?.uid,
      communityId,
      view
    );
  }
}

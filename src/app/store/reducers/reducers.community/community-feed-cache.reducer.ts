// src/app/store/reducers/reducers.community/community-feed-cache.reducer.ts

import { createReducer, on } from '@ngrx/store';

import {
  COMMUNITY_FEED_CACHE_MAX_SCOPES,
  buildCommunityFeedCacheKey,
  isCommunityFeedCacheHardExpired,
} from 'src/app/community/feed/community-feed-cache.model';
import {
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from 'src/app/community/feed/community-feed-state.model';

import * as CommunityFeedCacheActions from '../../actions/actions.community/community-feed-cache.actions';
import {
  CommunityFeedCacheSlice,
  CommunityFeedCacheState,
  initialCommunityFeedCacheState,
} from '../../states/states.community/community-feed-cache.state';

function normalizeTimestamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function initialSlice(accessedAt: number): CommunityFeedCacheSlice {
  return {
    state: INITIAL_COMMUNITY_FEED_STATE,
    lastLoadedAt: 0,
    lastAccessedAt: normalizeTimestamp(accessedAt),
  };
}

function scopeToViewer(
  state: CommunityFeedCacheState,
  viewerUid: string | null
): CommunityFeedCacheState {
  if (!viewerUid) return initialCommunityFeedCacheState;
  if (state.activeViewerUid === viewerUid) return state;

  return {
    activeViewerUid: viewerUid,
    byScope: {},
  };
}

function pruneScopes(
  byScope: Readonly<Record<string, CommunityFeedCacheSlice>>,
  now: number
): Readonly<Record<string, CommunityFeedCacheSlice>> {
  const activeEntries = Object.entries(byScope)
    .filter(([, slice]) =>
      !isCommunityFeedCacheHardExpired(slice.lastLoadedAt, now)
    )
    .sort((left, right) =>
      right[1].lastAccessedAt - left[1].lastAccessedAt
      || right[1].lastLoadedAt - left[1].lastLoadedAt
      || left[0].localeCompare(right[0])
    )
    .slice(0, COMMUNITY_FEED_CACHE_MAX_SCOPES);

  return Object.fromEntries(activeEntries);
}

export const communityFeedCacheReducer = createReducer(
  initialCommunityFeedCacheState,

  on(
    CommunityFeedCacheActions.activateCommunityFeedViewer,
    (state, { viewerUid }) => scopeToViewer(state, viewerUid)
  ),

  on(
    CommunityFeedCacheActions.touchCommunityFeedScope,
    (state, { query, accessedAt }) => {
      const now = normalizeTimestamp(accessedAt);
      const scoped = scopeToViewer(state, query.viewerUid);
      const key = buildCommunityFeedCacheKey(query);
      const current = scoped.byScope[key];
      const base = current
        && !isCommunityFeedCacheHardExpired(current.lastLoadedAt, now)
        ? current
        : initialSlice(now);
      const nextSlice: CommunityFeedCacheSlice = {
        ...base,
        lastAccessedAt: now,
      };

      return {
        ...scoped,
        byScope: pruneScopes(
          {
            ...scoped.byScope,
            [key]: nextSlice,
          },
          now
        ),
      };
    }
  ),

  on(
    CommunityFeedCacheActions.applyCommunityFeedEvent,
    (state, { query, event, occurredAt }) => {
      const now = normalizeTimestamp(occurredAt);
      const scoped = scopeToViewer(state, query.viewerUid);
      const key = buildCommunityFeedCacheKey(query);
      const current = scoped.byScope[key];
      const base = current
        && !isCommunityFeedCacheHardExpired(current.lastLoadedAt, now)
        ? current
        : initialSlice(now);
      const nextState = reduceCommunityFeedState(base.state, event);
      const refreshesFirstPage =
        event.type === 'success' && event.request.append !== true;
      const nextSlice: CommunityFeedCacheSlice = {
        state: nextState,
        lastLoadedAt: refreshesFirstPage ? now : base.lastLoadedAt,
        lastAccessedAt: now,
      };

      return {
        ...scoped,
        byScope: pruneScopes(
          {
            ...scoped.byScope,
            [key]: nextSlice,
          },
          now
        ),
      };
    }
  ),

  on(
    CommunityFeedCacheActions.clearCommunityFeedCache,
    () => initialCommunityFeedCacheState
  )
);

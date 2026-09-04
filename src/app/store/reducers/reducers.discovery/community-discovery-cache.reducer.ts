// src/app/store/reducers/reducers.discovery/community-discovery-cache.reducer.ts

import { createReducer, on } from '@ngrx/store';

import {
  COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES,
  buildCommunityDiscoveryCacheKey,
} from 'src/app/community/discovery/community-discovery-cache.model';
import type {
  CommunityPreviewCard,
  CommunityPreviewSourceType,
} from 'src/app/community/data-access/community-preview.model';

import * as CommunityDiscoveryCacheActions from '../../actions/actions.discovery/community-discovery-cache.actions';
import {
  CommunityDiscoveryCacheSlice,
  CommunityDiscoveryCacheState,
  initialCommunityDiscoveryCacheState,
} from '../../states/states.discovery/community-discovery-cache.state';

function mergeCards(
  current: readonly CommunityPreviewCard[],
  incoming: readonly CommunityPreviewCard[]
): readonly CommunityPreviewCard[] {
  const byId = new Map<string, CommunityPreviewCard>();

  for (const item of current) byId.set(item.communityId, item);
  for (const item of incoming) byId.set(item.communityId, item);

  return [...byId.values()];
}

function scopeToViewer(
  state: CommunityDiscoveryCacheState,
  viewerUid: string | null
): CommunityDiscoveryCacheState {
  if (!viewerUid) return initialCommunityDiscoveryCacheState;
  if (state.activeViewerUid === viewerUid) return state;

  return {
    activeViewerUid: viewerUid,
    byQuery: {},
  };
}

function limitCachedQueries(
  byQuery: Readonly<Record<string, CommunityDiscoveryCacheSlice>>,
  protectedKey: string
): Readonly<Record<string, CommunityDiscoveryCacheSlice>> {
  const entries = Object.entries(byQuery);
  if (entries.length <= COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES) {
    return byQuery;
  }

  entries.sort(([keyA, sliceA], [keyB, sliceB]) => {
    if (keyA === protectedKey) return -1;
    if (keyB === protectedKey) return 1;

    const recency = sliceB.lastLoadedAt - sliceA.lastLoadedAt;
    return recency !== 0 ? recency : keyA.localeCompare(keyB);
  });

  return Object.fromEntries(
    entries.slice(0, COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES)
  );
}

function matchesInvalidationScope(
  slice: CommunityDiscoveryCacheSlice,
  sourceType: CommunityPreviewSourceType | undefined,
  communityId: string | undefined
): boolean {
  if (sourceType && slice.query.sourceType !== sourceType) return false;
  if (
    communityId
    && !slice.items.some((item) => item.communityId === communityId)
  ) {
    return false;
  }

  return true;
}

export const communityDiscoveryCacheReducer = createReducer(
  initialCommunityDiscoveryCacheState,

  on(
    CommunityDiscoveryCacheActions.activateCommunityDiscoveryViewer,
    (state, { viewerUid }) => scopeToViewer(state, viewerUid)
  ),

  on(
    CommunityDiscoveryCacheActions.storeCommunityDiscoveryPage,
    (state, { query, page, append, storedAt }) => {
      const scoped = scopeToViewer(state, query.viewerUid);
      const key = buildCommunityDiscoveryCacheKey(query);
      const current = scoped.byQuery[key];
      const items = append && current
        ? mergeCards(current.items, page.items)
        : [...page.items];
      const nextByQuery = {
        ...scoped.byQuery,
        [key]: {
          query,
          items,
          nextCursor: page.nextCursor,
          lastLoadedAt: Math.max(0, Math.trunc(storedAt)),
        },
      };

      return {
        ...scoped,
        byQuery: limitCachedQueries(nextByQuery, key),
      };
    }
  ),

  on(
    CommunityDiscoveryCacheActions.invalidateCommunityDiscoveryViewer,
    (state, { viewerUid, sourceType, communityId }) => {
      if (!viewerUid || state.activeViewerUid !== viewerUid) return state;

      const normalizedCommunityId = communityId?.trim() || undefined;
      let changed = false;
      const byQuery = Object.fromEntries(
        Object.entries(state.byQuery).map(([key, slice]) => {
          if (
            !matchesInvalidationScope(
              slice,
              sourceType,
              normalizedCommunityId
            )
            || slice.lastLoadedAt === 0
          ) {
            return [key, slice];
          }

          changed = true;
          return [key, { ...slice, lastLoadedAt: 0 }];
        })
      );

      return changed ? { ...state, byQuery } : state;
    }
  ),

  on(
    CommunityDiscoveryCacheActions.clearCommunityDiscoveryCache,
    () => initialCommunityDiscoveryCacheState
  )
);

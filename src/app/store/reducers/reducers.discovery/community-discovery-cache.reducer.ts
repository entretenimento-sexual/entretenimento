// src/app/store/reducers/reducers.discovery/community-discovery-cache.reducer.ts

import { createReducer, on } from '@ngrx/store';

import { buildCommunityDiscoveryCacheKey } from 'src/app/community/discovery/community-discovery-cache.model';
import type { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';

import * as CommunityDiscoveryCacheActions from '../../actions/actions.discovery/community-discovery-cache.actions';
import {
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

      return {
        ...scoped,
        byQuery: {
          ...scoped.byQuery,
          [key]: {
            items,
            nextCursor: page.nextCursor,
            lastLoadedAt: Math.max(0, Math.trunc(storedAt)),
          },
        },
      };
    }
  ),

  on(
    CommunityDiscoveryCacheActions.invalidateCommunityDiscoveryViewer,
    (state, { viewerUid }) => {
      if (!viewerUid || state.activeViewerUid !== viewerUid) return state;

      const byQuery = Object.fromEntries(
        Object.entries(state.byQuery).map(([key, slice]) => [
          key,
          { ...slice, lastLoadedAt: 0 },
        ])
      );

      return { ...state, byQuery };
    }
  ),

  on(
    CommunityDiscoveryCacheActions.clearCommunityDiscoveryCache,
    () => initialCommunityDiscoveryCacheState
  )
);

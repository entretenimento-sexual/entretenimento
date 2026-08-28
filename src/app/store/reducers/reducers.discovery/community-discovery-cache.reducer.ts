// src/app/store/reducers/reducers.discovery/community-discovery-cache.reducer.ts

import { createReducer, on } from '@ngrx/store';

import {
  COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES,
  buildCommunityDiscoveryCacheKey,
  isCommunityDiscoveryCacheHardExpired,
} from 'src/app/community/discovery/community-discovery-cache.model';
import type { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';

import * as CommunityDiscoveryCacheActions from '../../actions/actions.discovery/community-discovery-cache.actions';
import {
  CommunityDiscoveryCacheSlice,
  CommunityDiscoveryCacheState,
  initialCommunityDiscoveryCacheState,
} from '../../states/states.discovery/community-discovery-cache.state';

function normalizeTimestamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

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

function pruneQueries(
  byQuery: Readonly<Record<string, CommunityDiscoveryCacheSlice>>,
  now: number
): Readonly<Record<string, CommunityDiscoveryCacheSlice>> {
  const activeEntries = Object.entries(byQuery)
    .filter(([, slice]) =>
      !isCommunityDiscoveryCacheHardExpired(slice.lastLoadedAt, now)
    )
    .sort((left, right) =>
      right[1].lastAccessedAt - left[1].lastAccessedAt
      || right[1].lastLoadedAt - left[1].lastLoadedAt
      || left[0].localeCompare(right[0])
    )
    .slice(0, COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES);

  return Object.fromEntries(activeEntries);
}

export const communityDiscoveryCacheReducer = createReducer(
  initialCommunityDiscoveryCacheState,

  on(
    CommunityDiscoveryCacheActions.activateCommunityDiscoveryViewer,
    (state, { viewerUid }) => scopeToViewer(state, viewerUid)
  ),

  on(
    CommunityDiscoveryCacheActions.touchCommunityDiscoveryQuery,
    (state, { query, accessedAt }) => {
      const now = normalizeTimestamp(accessedAt);
      const scoped = scopeToViewer(state, query.viewerUid);
      const key = buildCommunityDiscoveryCacheKey(query);
      const current = scoped.byQuery[key];
      const pruned = pruneQueries(scoped.byQuery, now);

      if (
        !current
        || isCommunityDiscoveryCacheHardExpired(current.lastLoadedAt, now)
      ) {
        return { ...scoped, byQuery: pruned };
      }

      return {
        ...scoped,
        byQuery: pruneQueries(
          {
            ...pruned,
            [key]: {
              ...current,
              lastAccessedAt: now,
            },
          },
          now
        ),
      };
    }
  ),

  on(
    CommunityDiscoveryCacheActions.storeCommunityDiscoveryPage,
    (state, { query, page, append, storedAt }) => {
      const now = normalizeTimestamp(storedAt);
      const scoped = scopeToViewer(state, query.viewerUid);
      const key = buildCommunityDiscoveryCacheKey(query);
      const current = scoped.byQuery[key];
      const currentHardExpired = current
        ? isCommunityDiscoveryCacheHardExpired(current.lastLoadedAt, now)
        : false;

      /**
       * Uma página adicional sem a primeira página válida não forma um snapshot
       * navegável. Descartamos esse append e forçamos revalidação na próxima leitura.
       */
      if (append && (!current || currentHardExpired)) {
        return {
          ...scoped,
          byQuery: pruneQueries(scoped.byQuery, now),
        };
      }

      const items = append && current
        ? mergeCards(current.items, page.items)
        : [...page.items];
      const lastLoadedAt = append && current
        ? current.lastLoadedAt
        : now;
      const invalidated = append && current
        ? current.invalidated
        : false;

      return {
        ...scoped,
        byQuery: pruneQueries(
          {
            ...scoped.byQuery,
            [key]: {
              items,
              nextCursor: page.nextCursor,
              lastLoadedAt,
              lastAccessedAt: now,
              invalidated,
            },
          },
          now
        ),
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
          { ...slice, invalidated: true },
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

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

function initialSlice(now: number): CommunityDiscoveryCacheSlice {
  return {
    status: 'loading',
    items: [],
    nextCursor: null,
    loadingMore: false,
    lastLoadedAt: 0,
    lastAccessedAt: normalizeTimestamp(now),
    invalidated: false,
  };
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

function hasRetainedSnapshot(slice: CommunityDiscoveryCacheSlice): boolean {
  return slice.lastLoadedAt > 0;
}

function resolvedStatus(
  slice: CommunityDiscoveryCacheSlice
): CommunityDiscoveryCacheSlice['status'] {
  if (!hasRetainedSnapshot(slice)) return 'error';
  return slice.items.length > 0 ? 'ready' : 'empty';
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
    CommunityDiscoveryCacheActions.beginCommunityDiscoveryLoad,
    (state, { query, append, startedAt }) => {
      const now = normalizeTimestamp(startedAt);
      const scoped = scopeToViewer(state, query.viewerUid);
      const key = buildCommunityDiscoveryCacheKey(query);
      const current = scoped.byQuery[key];
      const currentValid = current
        && !isCommunityDiscoveryCacheHardExpired(current.lastLoadedAt, now)
          ? current
          : null;
      const pruned = pruneQueries(scoped.byQuery, now);

      if (append && !currentValid) {
        return { ...scoped, byQuery: pruned };
      }

      const base = currentValid ?? initialSlice(now);
      const nextSlice: CommunityDiscoveryCacheSlice = {
        ...base,
        status:
          append || hasRetainedSnapshot(base)
            ? base.status
            : 'loading',
        loadingMore: append,
        lastAccessedAt: now,
      };

      return {
        ...scoped,
        byQuery: pruneQueries(
          {
            ...pruned,
            [key]: nextSlice,
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
              status: items.length > 0 ? 'ready' : 'empty',
              items,
              nextCursor: page.nextCursor,
              loadingMore: false,
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
    CommunityDiscoveryCacheActions.failCommunityDiscoveryLoad,
    (state, { query, failedAt }) => {
      const now = normalizeTimestamp(failedAt);
      const scoped = scopeToViewer(state, query.viewerUid);
      const key = buildCommunityDiscoveryCacheKey(query);
      const current = scoped.byQuery[key];
      const currentValid = current
        && !isCommunityDiscoveryCacheHardExpired(current.lastLoadedAt, now)
          ? current
          : null;
      const pruned = pruneQueries(scoped.byQuery, now);
      const base = currentValid ?? initialSlice(now);
      const nextSlice: CommunityDiscoveryCacheSlice = {
        ...base,
        status: resolvedStatus(base),
        loadingMore: false,
        lastAccessedAt: now,
      };

      return {
        ...scoped,
        byQuery: pruneQueries(
          {
            ...pruned,
            [key]: nextSlice,
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

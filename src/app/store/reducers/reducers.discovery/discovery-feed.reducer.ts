// src/app/store/reducers/reducers.discovery/discovery-feed.reducer.ts

import { createReducer, on } from '@ngrx/store';

import { PublicProfileCard } from 'src/app/dashboard/discovery/models/public-profile-card.model';
import { buildDiscoveryFeedQueryKey } from 'src/app/dashboard/discovery/models/discovery-feed-page.model';

import * as DiscoveryActions from '../../actions/actions.discovery/discovery-feed.actions';
import {
  DiscoveryFeedSlice,
  emptyDiscoveryFeedSlice,
  initialDiscoveryFeedState,
} from '../../states/states.discovery/discovery-feed.state';

function getSlice(
  state: typeof initialDiscoveryFeedState,
  queryKey: string
): DiscoveryFeedSlice {
  return state.byQuery[queryKey] ?? emptyDiscoveryFeedSlice;
}

function mergeProfiles(
  current: readonly PublicProfileCard[],
  incoming: readonly PublicProfileCard[],
  append: boolean
): readonly PublicProfileCard[] {
  if (!append) {
    return [...incoming];
  }

  const byUid = new Map<string, PublicProfileCard>();

  for (const item of current) {
    if (item.uid) {
      byUid.set(item.uid, item);
    }
  }

  for (const item of incoming) {
    if (item.uid) {
      byUid.set(item.uid, item);
    }
  }

  return Array.from(byUid.values());
}

export const discoveryFeedReducer = createReducer(
  initialDiscoveryFeedState,

  on(
    DiscoveryActions.loadDiscoveryFirstPage,
    DiscoveryActions.refreshDiscoveryFeed,
    (state, { request }) => {
      const queryKey = buildDiscoveryFeedQueryKey(request);
      const current = getSlice(state, queryKey);
      const hasItems = current.items.length > 0;

      return {
        ...state,
        byQuery: {
          ...state.byQuery,
          [queryKey]: {
            ...current,
            loadingInitial: !hasItems,
            loadingMore: false,
            refreshing: hasItems,
            error: null,
          },
        },
      };
    }
  ),

  on(DiscoveryActions.loadDiscoveryNextPage, (state, { request }) => {
    const queryKey = buildDiscoveryFeedQueryKey(request);
    const current = getSlice(state, queryKey);

    return {
      ...state,
      byQuery: {
        ...state.byQuery,
        [queryKey]: {
          ...current,
          loadingMore: true,
          error: null,
        },
      },
    };
  }),

  on(
    DiscoveryActions.loadDiscoveryPageSuccess,
    (state, { request, page, append }) => {
      const queryKey = buildDiscoveryFeedQueryKey(request);
      const current = getSlice(state, queryKey);
      const fromCache = page.source === 'cache';

      return {
        ...state,
        byQuery: {
          ...state.byQuery,
          [queryKey]: {
            ...current,
            items: mergeProfiles(current.items, page.items, append),
            nextCursor: page.nextCursor,
            reachedEnd: page.reachedEnd,
            loadingInitial: false,
            loadingMore: false,
            refreshing: fromCache,
            error: null,
            lastLoadedAt: fromCache
              ? current.lastLoadedAt
              : page.fetchedAt,
          },
        },
      };
    }
  ),

  on(DiscoveryActions.loadDiscoveryPageFailure, (state, { request, error }) => {
    const queryKey = buildDiscoveryFeedQueryKey(request);
    const current = getSlice(state, queryKey);

    return {
      ...state,
      byQuery: {
        ...state.byQuery,
        [queryKey]: {
          ...current,
          loadingInitial: false,
          loadingMore: false,
          refreshing: false,
          error,
        },
      },
    };
  }),

  on(DiscoveryActions.clearDiscoveryFeeds, () => initialDiscoveryFeedState)
);

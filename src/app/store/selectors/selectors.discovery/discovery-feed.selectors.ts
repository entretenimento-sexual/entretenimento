// src/app/store/selectors/selectors.discovery/discovery-feed.selectors.ts

import { createSelector } from '@ngrx/store';

import { AppState } from '../../states/app.state';
import {
  DiscoveryFeedSlice,
  emptyDiscoveryFeedSlice,
} from '../../states/states.discovery/discovery-feed.state';

export const selectDiscoveryFeedState = (state: AppState) =>
  state.discoveryFeeds;

export const selectDiscoveryFeedSlice = (queryKey: string) =>
  createSelector(
    selectDiscoveryFeedState,
    (state): DiscoveryFeedSlice =>
      state.byQuery[queryKey] ?? emptyDiscoveryFeedSlice
  );

export const selectDiscoveryFeedItems = (queryKey: string) =>
  createSelector(
    selectDiscoveryFeedSlice(queryKey),
    (slice) => slice.items
  );

export const selectDiscoveryFeedNextCursor = (queryKey: string) =>
  createSelector(
    selectDiscoveryFeedSlice(queryKey),
    (slice) => slice.nextCursor
  );

export const selectDiscoveryFeedReachedEnd = (queryKey: string) =>
  createSelector(
    selectDiscoveryFeedSlice(queryKey),
    (slice) => slice.reachedEnd
  );

export const selectDiscoveryFeedLoadingMore = (queryKey: string) =>
  createSelector(
    selectDiscoveryFeedSlice(queryKey),
    (slice) => slice.loadingMore
  );

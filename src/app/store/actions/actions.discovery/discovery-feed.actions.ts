// src/app/store/actions/actions.discovery/discovery-feed.actions.ts

import { createAction, props } from '@ngrx/store';

import {
  DiscoveryFeedPage,
  DiscoveryFeedRequest,
} from 'src/app/dashboard/discovery/models/discovery-feed-page.model';

export const loadDiscoveryFirstPage = createAction(
  '[Discovery Feed] Load First Page',
  props<{ request: DiscoveryFeedRequest }>()
);

export const refreshDiscoveryFeed = createAction(
  '[Discovery Feed] Refresh',
  props<{ request: DiscoveryFeedRequest }>()
);

export const loadDiscoveryNextPage = createAction(
  '[Discovery Feed] Load Next Page',
  props<{ request: DiscoveryFeedRequest }>()
);

export const loadDiscoveryPageSuccess = createAction(
  '[Discovery Feed] Load Page Success',
  props<{
    request: DiscoveryFeedRequest;
    page: DiscoveryFeedPage;
    append: boolean;
  }>()
);

export const loadDiscoveryPageFailure = createAction(
  '[Discovery Feed] Load Page Failure',
  props<{
    request: DiscoveryFeedRequest;
    error: string;
  }>()
);

export const clearDiscoveryFeeds = createAction(
  '[Discovery Feed] Clear All'
);

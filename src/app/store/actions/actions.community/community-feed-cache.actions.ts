// src/app/store/actions/actions.community/community-feed-cache.actions.ts

import { createAction, props } from '@ngrx/store';

import type { CommunityFeedCacheQuery } from 'src/app/community/feed/community-feed-cache.model';
import type { CommunityFeedLoadEvent } from 'src/app/community/feed/community-feed-state.model';

export const activateCommunityFeedViewer = createAction(
  '[Community Feed Cache] Activate Viewer',
  props<{ viewerUid: string | null }>()
);

export const touchCommunityFeedScope = createAction(
  '[Community Feed Cache] Touch Scope',
  props<{
    query: CommunityFeedCacheQuery;
    accessedAt: number;
  }>()
);

export const applyCommunityFeedEvent = createAction(
  '[Community Feed Cache] Apply Event',
  props<{
    query: CommunityFeedCacheQuery;
    event: CommunityFeedLoadEvent;
    occurredAt: number;
  }>()
);

export const clearCommunityFeedCache = createAction(
  '[Community Feed Cache] Clear'
);

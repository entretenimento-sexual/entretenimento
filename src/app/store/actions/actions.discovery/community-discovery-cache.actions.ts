// src/app/store/actions/actions.discovery/community-discovery-cache.actions.ts

import { createAction, props } from '@ngrx/store';

import type {
  CommunityDiscoveryPage,
  CommunityPreviewSourceType,
} from 'src/app/community/data-access/community-preview.model';
import type { CommunityDiscoveryCacheQuery } from 'src/app/community/discovery/community-discovery-cache.model';

export const activateCommunityDiscoveryViewer = createAction(
  '[Community Discovery Cache] Activate Viewer',
  props<{ viewerUid: string | null }>()
);

export const storeCommunityDiscoveryPage = createAction(
  '[Community Discovery Cache] Store Page',
  props<{
    query: CommunityDiscoveryCacheQuery;
    page: CommunityDiscoveryPage;
    append: boolean;
    storedAt: number;
  }>()
);

export const invalidateCommunityDiscoveryViewer = createAction(
  '[Community Discovery Cache] Invalidate Viewer',
  props<{
    viewerUid: string;
    sourceType?: CommunityPreviewSourceType;
    communityId?: string;
  }>()
);

export const clearCommunityDiscoveryCache = createAction(
  '[Community Discovery Cache] Clear'
);

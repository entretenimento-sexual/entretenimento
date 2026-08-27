// src/app/store/selectors/selectors.discovery/community-discovery-cache.selectors.ts

import { createSelector } from '@ngrx/store';

import type { AppState } from '../../states/app.state';
import type { CommunityDiscoveryCacheSlice } from '../../states/states.discovery/community-discovery-cache.state';

export const selectCommunityDiscoveryCacheState = (state: AppState) =>
  state.communityDiscoveryCache;

export const selectCommunityDiscoveryCacheSlice = (queryKey: string) =>
  createSelector(
    selectCommunityDiscoveryCacheState,
    (state): CommunityDiscoveryCacheSlice | null =>
      state.byQuery[queryKey] ?? null
  );

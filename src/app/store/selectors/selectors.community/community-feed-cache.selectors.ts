// src/app/store/selectors/selectors.community/community-feed-cache.selectors.ts

import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { CommunityFeedCacheQuery } from 'src/app/community/feed/community-feed-cache.model';
import { buildCommunityFeedCacheKey } from 'src/app/community/feed/community-feed-cache.model';
import { INITIAL_COMMUNITY_FEED_STATE } from 'src/app/community/feed/community-feed-state.model';

import { STORE_FEATURE } from '../../reducers/feature-keys';
import type {
  CommunityFeedCacheSlice,
  CommunityFeedCacheState,
} from '../../states/states.community/community-feed-cache.state';

export const selectCommunityFeedCache =
  createFeatureSelector<CommunityFeedCacheState>(
    STORE_FEATURE.communityFeedCache
  );

export function selectCommunityFeedCacheSlice(
  query: CommunityFeedCacheQuery
) {
  const key = buildCommunityFeedCacheKey(query);

  return createSelector(
    selectCommunityFeedCache,
    (state): CommunityFeedCacheSlice | null => {
      if (state.activeViewerUid !== query.viewerUid) return null;
      return state.byScope[key] ?? null;
    }
  );
}

export function selectCommunityFeedState(
  query: CommunityFeedCacheQuery
) {
  return createSelector(
    selectCommunityFeedCacheSlice(query),
    (slice) => slice?.state ?? INITIAL_COMMUNITY_FEED_STATE
  );
}

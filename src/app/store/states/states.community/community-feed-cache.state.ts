// src/app/store/states/states.community/community-feed-cache.state.ts

import type { CommunityFeedState } from 'src/app/community/feed/community-feed-state.model';

export interface CommunityFeedCacheSlice {
  readonly state: CommunityFeedState;
  readonly lastLoadedAt: number;
  readonly lastAccessedAt: number;
}

export interface CommunityFeedCacheState {
  readonly activeViewerUid: string | null;
  readonly byScope: Readonly<Record<string, CommunityFeedCacheSlice>>;
}

export const initialCommunityFeedCacheState: CommunityFeedCacheState = {
  activeViewerUid: null,
  byScope: {},
};

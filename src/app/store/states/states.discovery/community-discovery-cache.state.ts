// src/app/store/states/states.discovery/community-discovery-cache.state.ts

import type { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';
import type { CommunityDiscoveryCacheQuery } from 'src/app/community/discovery/community-discovery-cache.model';

export interface CommunityDiscoveryCacheSlice {
  readonly query: CommunityDiscoveryCacheQuery;
  readonly items: readonly CommunityPreviewCard[];
  readonly nextCursor: string | null;
  readonly lastLoadedAt: number;
}

export interface CommunityDiscoveryCacheState {
  readonly activeViewerUid: string | null;
  readonly byQuery: Readonly<Record<string, CommunityDiscoveryCacheSlice>>;
}

export const initialCommunityDiscoveryCacheState: CommunityDiscoveryCacheState = {
  activeViewerUid: null,
  byQuery: {},
};

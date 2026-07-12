// src/app/store/states/states.discovery/discovery-feed.state.ts

import { PublicProfileCard } from 'src/app/dashboard/discovery/models/public-profile-card.model';
import { DiscoveryFeedCursor } from 'src/app/dashboard/discovery/models/discovery-feed-page.model';

export interface DiscoveryFeedSlice {
  readonly items: readonly PublicProfileCard[];
  readonly nextCursor: DiscoveryFeedCursor | null;
  readonly reachedEnd: boolean;
  readonly loadingInitial: boolean;
  readonly loadingMore: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
  readonly lastLoadedAt: number | null;
}

export interface DiscoveryFeedState {
  readonly byQuery: Readonly<Record<string, DiscoveryFeedSlice>>;
}

export const emptyDiscoveryFeedSlice: DiscoveryFeedSlice = {
  items: [],
  nextCursor: null,
  reachedEnd: false,
  loadingInitial: false,
  loadingMore: false,
  refreshing: false,
  error: null,
  lastLoadedAt: null,
};

export const initialDiscoveryFeedState: DiscoveryFeedState = {
  byQuery: {},
};

// src/app/store/reducers/index.ts
// Root reducer map do app.
// Mantém a arquitetura compreensível:
// - keys vêm de STORE_FEATURE
// - reducers vêm dos índices por domínio
import { ActionReducerMap } from '@ngrx/store';
import { AppState } from '../states/app.state';

import { STORE_FEATURE } from './feature-keys';

import { chatReducers } from './reducers.chat';
import { userReducers } from './reducers.user';
import { locationReducers } from './reducers.location';
import { interactionsReducers } from './reducers.interactions';
import { discoveryFeedReducer } from './reducers.discovery/discovery-feed.reducer';
import { communityDiscoveryCacheReducer } from './reducers.discovery/community-discovery-cache.reducer';
import { communityFeedCacheReducer } from './reducers.community/community-feed-cache.reducer';

export const reducers: ActionReducerMap<AppState> = {
  // USER DOMAIN
  [STORE_FEATURE.auth]: userReducers.auth,
  [STORE_FEATURE.user]: userReducers.user,
  [STORE_FEATURE.terms]: userReducers.terms,
  [STORE_FEATURE.file]: userReducers.file,
  [STORE_FEATURE.userPreferences]: userReducers.userPreferences,

  // MESSAGING GLOBAL
  [STORE_FEATURE.invite]: chatReducers.invite,

  // LOCATION DOMAIN
  [STORE_FEATURE.location]: locationReducers.location,
  [STORE_FEATURE.nearbyProfiles]: locationReducers.nearbyProfiles,

  // DISCOVERY DOMAIN
  [STORE_FEATURE.discoveryFeeds]: discoveryFeedReducer,
  [STORE_FEATURE.communityDiscoveryCache]: communityDiscoveryCacheReducer,

  // COMMUNITY DOMAIN
  [STORE_FEATURE.communityFeedCache]: communityFeedCacheReducer,

  // INTERACTIONS DOMAIN
  [STORE_FEATURE.friendsPages]: interactionsReducers.friendsPages,
  [STORE_FEATURE.interactionsFriends]: interactionsReducers.interactions_friends,
};

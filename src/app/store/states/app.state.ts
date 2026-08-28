// src/app/store/states/app.state.ts
import { authReducer } from '../reducers/reducers.user/auth.reducer';
import { userReducer } from '../reducers/reducers.user/user.reducer';
import { termsReducer } from '../reducers/reducers.user/terms.reducer';
import { fileReducer } from '../reducers/reducers.user/file.reducer';
import { userPreferencesReducer } from '../reducers/reducers.user/user-preferences.reducer';

import { inviteReducer } from '../reducers/reducers.chat/invite.reducer';

import { locationReducer } from '../reducers/reducers.location/location.reducer';
import { nearbyProfilesReducer } from '../reducers/reducers.location/nearby-profiles.reducer';

import { friendsPaginationReducer } from '../reducers/reducers.interactions/friends-pagination.reducer';
import { friendsReducer } from '../reducers/reducers.interactions/friends.reducer';
import { discoveryFeedReducer } from '../reducers/reducers.discovery/discovery-feed.reducer';
import { communityDiscoveryCacheReducer } from '../reducers/reducers.discovery/community-discovery-cache.reducer';
import { communityFeedCacheReducer } from '../reducers/reducers.community/community-feed-cache.reducer';

export interface AppState {
  // USER DOMAIN
  auth: ReturnType<typeof authReducer>;
  user: ReturnType<typeof userReducer>;
  terms: ReturnType<typeof termsReducer>;
  file: ReturnType<typeof fileReducer>;
  userPreferences: ReturnType<typeof userPreferencesReducer>;
  friendsPages: ReturnType<typeof friendsPaginationReducer>;

  // MESSAGING GLOBAL
  invite: ReturnType<typeof inviteReducer>;

  // LOCATION DOMAIN
  location: ReturnType<typeof locationReducer>;
  nearbyProfiles: ReturnType<typeof nearbyProfilesReducer>;

  // DISCOVERY DOMAIN
  discoveryFeeds: ReturnType<typeof discoveryFeedReducer>;
  communityDiscoveryCache: ReturnType<typeof communityDiscoveryCacheReducer>;

  // COMMUNITY DOMAIN
  communityFeedCache: ReturnType<typeof communityFeedCacheReducer>;

  // INTERACTIONS DOMAIN
  interactions_friends: ReturnType<typeof friendsReducer>;
}

/*
CurrentUserStore manda no IUserDados.
Qualquer UID fora disso vira derivado / compat.
Alguns fluxos legados ainda precisam ser migrados.
*/

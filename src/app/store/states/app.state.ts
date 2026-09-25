// src/app/store/states/app.state.ts
import { authReducer } from '../reducers/reducers.user/auth.reducer';
import { userReducer } from '../reducers/reducers.user/user.reducer';
import { fileReducer } from '../reducers/reducers.user/file.reducer';
import { userPreferencesReducer } from '../reducers/reducers.user/user-preferences.reducer';


import { locationReducer } from '../reducers/reducers.location/location.reducer';
import { nearbyProfilesReducer } from '../reducers/reducers.location/nearby-profiles.reducer';

import { friendsPaginationReducer } from '../reducers/reducers.interactions/friends-pagination.reducer';
import { friendsReducer } from '../reducers/reducers.interactions/friends.reducer';
import { discoveryFeedReducer } from '../reducers/reducers.discovery/discovery-feed.reducer';
import { communityDiscoveryCacheReducer } from '../reducers/reducers.discovery/community-discovery-cache.reducer';

export interface AppState {
  // USER DOMAIN
  auth: ReturnType<typeof authReducer>;
  user: ReturnType<typeof userReducer>;
  file: ReturnType<typeof fileReducer>;
  userPreferences: ReturnType<typeof userPreferencesReducer>;
  friendsPages: ReturnType<typeof friendsPaginationReducer>;

  // LOCATION DOMAIN
  location: ReturnType<typeof locationReducer>;
  nearbyProfiles: ReturnType<typeof nearbyProfilesReducer>;

  // DISCOVERY DOMAIN
  discoveryFeeds: ReturnType<typeof discoveryFeedReducer>;
  communityDiscoveryCache: ReturnType<typeof communityDiscoveryCacheReducer>;

  // INTERACTIONS DOMAIN
  interactions_friends: ReturnType<typeof friendsReducer>;
}

/*
CurrentUserStore manda no IUserDados.
Qualquer UID fora disso vira derivado / compat.
Alguns fluxos legados ainda precisam ser migrados.
*/

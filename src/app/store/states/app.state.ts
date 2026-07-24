// src/app/store/states/app.state.ts
// Estado global apenas com slices de domínio compartilhado.
import { authReducer } from '../reducers/reducers.user/auth.reducer';
import { userReducer } from '../reducers/reducers.user/user.reducer';
import { termsReducer } from '../reducers/reducers.user/terms.reducer';
import { fileReducer } from '../reducers/reducers.user/file.reducer';
import { userPreferencesReducer } from '../reducers/reducers.user/user-preferences.reducer';

import { chatReducer } from '../reducers/reducers.chat/chat.reducer';
import { inviteReducer } from '../reducers/reducers.chat/invite.reducer';
import { roomReducer } from '../reducers/reducers.chat/room.reducer';

import { locationReducer } from '../reducers/reducers.location/location.reducer';
import { nearbyProfilesReducer } from '../reducers/reducers.location/nearby-profiles.reducer';
import { friendsPaginationReducer } from '../reducers/reducers.interactions/friends-pagination.reducer';
import { friendsReducer } from '../reducers/reducers.interactions/friends.reducer';

export interface AppState {
  // USER DOMAIN
  auth: ReturnType<typeof authReducer>;
  user: ReturnType<typeof userReducer>;
  terms: ReturnType<typeof termsReducer>;
  file: ReturnType<typeof fileReducer>;
  userPreferences: ReturnType<typeof userPreferencesReducer>;
  friendsPages: ReturnType<typeof friendsPaginationReducer>;

  // CHAT DOMAIN
  chat: ReturnType<typeof chatReducer>;
  invite: ReturnType<typeof inviteReducer>;
  room: ReturnType<typeof roomReducer>;

  // LOCATION DOMAIN
  location: ReturnType<typeof locationReducer>;
  nearbyProfiles: ReturnType<typeof nearbyProfilesReducer>;

  // INTERACTIONS DOMAIN
  interactions_friends: ReturnType<typeof friendsReducer>;
}

// \src\app\store\reducers\index.ts
import { ActionReducerMap } from '@ngrx/store';
import { AppState } from '../states/app.state';

import { authReducer } from './reducers.user/auth.reducer';
import { userReducer } from './reducers.user/user.reducer';
import { termsReducer } from './reducers.user/terms.reducer';
import { fileReducer } from './reducers.user/file.reducer';
import { userPreferencesReducer } from './reducers.user/user-preferences.reducer';

import { chatReducer } from './reducers.chat/chat.reducer';
import { inviteReducer } from './reducers.chat/invite.reducer';
import { roomReducer } from './reducers.chat/room.reducer';

import { locationReducer } from './reducers.location/location.reducer';
import { nearbyProfilesReducer } from './reducers.location/nearby-profiles.reducer';

import { friendsReducer } from './reducers.interactions/friends.reduce';

import { cacheReducer } from './cache.reducer';

export const reducers: ActionReducerMap<AppState> = {
  // USER DOMAIN
  auth: authReducer,
  user: userReducer,
  terms: termsReducer,
  file: fileReducer,
  userPreferences: userPreferencesReducer,

  // INTERACTIONS DOMAIN
  friends: friendsReducer,

  // LOCATION DOMAIN
  location: locationReducer,
  nearbyProfiles: nearbyProfilesReducer,

  // CHAT DOMAIN
  chat: chatReducer,
  invite: inviteReducer,
  room: roomReducer,

  // CACHE
  cache: cacheReducer,
};

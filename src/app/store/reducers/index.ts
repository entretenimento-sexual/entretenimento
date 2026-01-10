// src/app/store/reducers/index.ts
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

import { cacheReducer } from './cache.reducer';
// ✅ imports de paginação de amigos
import { friendsPaginationReducer } from './reducers.interactions/friends-pagination.reducer';
import { friendsReducer } from './reducers.interactions/friends.reduce';

export const reducers: ActionReducerMap<AppState> = {
  // USER DOMAIN
  auth: authReducer,
  user: userReducer,
  terms: termsReducer,
  file: fileReducer,
  userPreferences: userPreferencesReducer,

  // LOCATION DOMAIN
  location: locationReducer,
  nearbyProfiles: nearbyProfilesReducer,

  // CHAT DOMAIN
  chat: chatReducer,
  invite: inviteReducer,
  room: roomReducer,

  // CACHE
  cache: cacheReducer,

  // ✅ FRIENDS (root, já que carrega no boot)
  interactions_friends: friendsReducer,

  // ✅ PAGINAÇÃO DE AMIGOS (root slice simples)
  friendsPages: friendsPaginationReducer,
};

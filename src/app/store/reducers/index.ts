// src/app/store/reducers/index.ts
// Root reducer map do app.
//
// SUPRESSÃO EXPLÍCITA:
// - removido o reducer genérico de cache.
//   Motivo: cache não é estado de domínio, não recebia actions de consumidores e
//   duplicava memória/IndexedDB. Cache tipado fica fora do Store.
import { ActionReducerMap } from '@ngrx/store';
import { AppState } from '../states/app.state';

import { STORE_FEATURE } from './feature-keys';
import { chatReducers } from './reducers.chat';
import { userReducers } from './reducers.user';
import { locationReducers } from './reducers.location';
import { interactionsReducers } from './reducers.interactions';

export const reducers: ActionReducerMap<AppState> = {
  // USER DOMAIN
  [STORE_FEATURE.auth]: userReducers.auth,
  [STORE_FEATURE.user]: userReducers.user,
  [STORE_FEATURE.terms]: userReducers.terms,
  [STORE_FEATURE.file]: userReducers.file,
  [STORE_FEATURE.userPreferences]: userReducers.userPreferences,

  // CHAT DOMAIN
  [STORE_FEATURE.chat]: chatReducers.chat,
  [STORE_FEATURE.invite]: chatReducers.invite,
  [STORE_FEATURE.room]: chatReducers.room,

  // LOCATION DOMAIN
  [STORE_FEATURE.location]: locationReducers.location,
  [STORE_FEATURE.nearbyProfiles]: locationReducers.nearbyProfiles,

  // INTERACTIONS DOMAIN
  [STORE_FEATURE.friendsPages]: interactionsReducers.friendsPages,
  [STORE_FEATURE.interactionsFriends]:
    interactionsReducers.interactions_friends,
};

// src/app/store/states/app.state.ts
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

import { cacheReducer } from '../reducers/cache.reducer';
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

  // CACHE
  cache: ReturnType<typeof cacheReducer>;

  // ✅ agora existe de verdade no AppState
  interactions_friends: ReturnType<typeof friendsReducer>;
}
/*CurrentUserStore manda no IUserDados
qualquer UID fora disso vira derivado / compat
//logout() do auth.service.ts que está sendo descontinuado
// ainda está sendo usado em alguns lugares e precisa ser migrado.
Ferramentas de debug ajudam bastante
É assim que funcionam as grandes plataformas?
Compatibilizar o estado online do usuário com o presence.service e aproximar do funcionamento ideal
*/

/* C:.
│   store.module.ts
│
├───actions
│   │   cache.actions.ts
│   │
│   ├───actions.chat
│   │       chat.actions.ts
│   │       invite.actions.ts
│   │       room.actions.ts
│   │
│   ├───actions.interactions
│   │   │   actions.friends.ts
│   │   │
│   │   └───friends
│   │           friends - blocks.actions.ts
│   │           friends - list.actions.ts
│   │           friends - misc.actions.ts
│   │           friends - pagination.actions.ts
│   │           friends - realtime.actions.ts
│   │           friends - requests.actions.ts
│   │           index.ts
│   │
│   ├───actions.location
│   │       location.actions.ts
│   │       nearby - profiles.actions.spec.ts
│   │       nearby - profiles.actions.ts
│   │
│   └───actions.user
│           auth.actions.ts
│           file.actions.ts
│           terms.actions.ts
│           user - preferences.actions.ts
│           user - role.actions.ts
│           user.actions.ts
│
├───effects
│   │   cache.effects.ts
│   │
│   ├───effects.chat
│   │       chat.effects.ts
│   │       invite.effects.ts
│   │       room.effects.ts
│   │
│   ├───effects.interactions
│   │   ├───friends
│   │   │       index.ts
│   │   │       network.effects.ts
│   │   │       pagination.effects.ts
│   │   │       requests - crud.effects.ts
│   │   │       requests - profiles.effects.ts
│   │   │       requests - realtime.effects.ts
│   │   │
│   │   └───helpers
│   │           effects - helpers.ts
│   │
│   ├───effects.location
│   │       location.effects.ts
│   │       nearby - profiles.effects.spec.ts
│   │       nearby - profiles.effects.ts
│   │
│   └───effects.user
│           auth - session - sync.effects.ts
│           auth - status - sync.effects.ts
│           auth.effects.ts
│           file.effects.ts
│           online - users.effects.ts
│           terms.effects.ts
│           user - preferences.effects.ts
│           user - role.effects.ts
│           user.effects.ts
│
├───reducers
│   │   cache.reducer.ts
│   │   index.ts
│   │
│   ├───reducers.chat
│   │       chat.reducer.ts
│   │       invite.reducer.ts
│   │       room.reducer.ts
│   │
│   ├───reducers.interactions
│   │       friends - pagination.reducer.ts
│   │       friends.reduce.ts
│   │
│   ├───reducers.location
│   │       location.reducer.spec.ts
│   │       location.reducer.ts
│   │       nearby - profiles.reducer.spec.ts
│   │       nearby - profiles.reducer.ts
│   │
│   └───reducers.user
│           auth.reducer.ts
│           file.reducer.ts
│           terms.reducer.ts
│           user - preferences.reducer.ts
│           user.reducer.spec.ts
│           user.reducer.ts
│
├───selectors
│   │   cache.selectors.ts
│   │
│   ├───selectors.chat
│   │       chat.selectors.ts
│   │       invite.selectors.ts
│   │       room.selectors.ts
│   │
│   ├───selectors.interactions
│   │   │   friend.selector.ts
│   │   │
│   │   └───friends
│   │       │   blocked.selectors.ts
│   │       │   busy.selectors.ts
│   │       │   feature.ts
│   │       │   friends.selectors.ts
│   │       │   inbound.selectors.ts
│   │       │   index.ts
│   │       │   outbound.selectors.ts
│   │       │   pagination.selectors.ts
│   │       │   search.selectors.ts
│   │       │   vm.selectors.ts
│   │       │
│   │       └───vm - selectors
│   │               all.rich.ts
│   │               inbound.rich.ts
│   │               index.ts
│   │               outbound.rich.ts
│   │               vm.utils.ts
│   │
│   ├───selectors.location
│   │       location.selectors.spec.ts
│   │       location.selectors.ts
│   │       nearby - profiles.selectors.ts
│   │
│   └───selectors.user
│           access.selectors.ts
│           auth.selectors.ts
│           file.selectors.ts
│           online.selectors.ts
│           terms.selectors.ts
│           user - preferences.selectors.ts
│           user - profile.selectors.ts
│           user.selectors.ts
│
└───states
    │   app.state.ts
    │
    ├───states.chat
    │       chat.state.ts
    │       invite.state.ts
    │       room.state.ts
    │
    ├───states.interactions
    │       friends - pagination.state.ts
    │       friends.state.ts
    │
    ├───states.location
    │       location.state.ts
    │       nearby - profiles.state.ts
    │
    └───states.user
auth.models.ts
auth.state.ts
file.state.ts
terms.state.ts
user - preferences.state.ts
user.state.ts
 */

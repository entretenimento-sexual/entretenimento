// src/app/store/store.module.ts
// Módulo central do NgRx Store: configura reducers, effects, DevTools, runtimeChecks etc.
// Manter comentários para facilitar navegação no código
import { NgModule } from '@angular/core';
import { StoreModule, ActionReducer } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { environment } from '../../environments/environment';

// ROOT reducers (index.ts centraliza seus reducers root)
import { reducers } from './reducers';

// EFFECTS - USER
import { AuthEffects } from './effects/effects.user/auth.effects';
import { UserEffects } from './effects/effects.user/user.effects';
import { FileEffects } from './effects/effects.user/file.effects';
import { OnlineUsersEffects } from './effects/effects.user/online-users.effects';
import { TermsEffects } from './effects/effects.user/terms.effects';
import { UserPreferencesEffects } from './effects/effects.user/user-preferences.effects';
import { UserRoleEffects } from './effects/effects.user/user-role.effects';
import { AuthStatusSyncEffects } from './effects/effects.user/auth-status-sync.effects';

// EFFECTS - CHAT
import { ChatEffects } from './effects/effects.chat/chat.effects';
import { InviteEffects } from './effects/effects.chat/invite.effects';
import { RoomEffects } from './effects/effects.chat/room.effects';

// EFFECTS - INTERACTIONS - FRIENDS
import { FriendsRequestsCrudEffects } from './effects/effects.interactions/friends/requests-crud.effects';
import { FriendsNetworkEffects } from './effects/effects.interactions/friends/network.effects';
import { FriendsRequestsProfilesEffects } from './effects/effects.interactions/friends/requests-profiles.effects';
import { FriendsRequestsRealtimeEffects } from './effects/effects.interactions/friends/requests-realtime.effects';
import { FriendsPaginationEffects } from './effects/effects.interactions/friends/pagination.effects';

// EFFECTS - LOCATION
import { NearbyProfilesEffects } from './effects/effects.location/nearby-profiles.effects';
import { LocationEffects } from './effects/effects.location/location.effects';

// EFFECTS - CACHE
import { CacheEffects } from './effects/cache.effects';

// REDUCERS - FEATURE
import { AuthSessionSyncEffects } from './effects/effects.user/auth-session-sync.effects';

/**
 * Logger inline (opcional). Deixe desativado por padrão.
 * Se precisar depurar tempo/estado por ação, ative
 * adicionando `loggerMetaReducer` ao array `metaReducers` logo abaixo.
 */
function loggerMetaReducer<S>(reducer: ActionReducer<S>): ActionReducer<S> {
  //loggerMetaReducer está esmaecido
  if (environment.production) return reducer;
  return (state, action) => {
    const t0 = performance?.now?.() ?? Date.now();
    const next = reducer(state, action);
    const t1 = performance?.now?.() ?? Date.now();
    // eslint-disable-next-line no-console
    console.groupCollapsed?.(`[NGRX] ${action.type} +${(t1 - t0).toFixed(2)}ms`);
    // eslint-disable-next-line no-console
    console.log('prev:', state);
    // eslint-disable-next-line no-console
    console.log('action:', action);
    // eslint-disable-next-line no-console
    console.log('next:', next);
    // eslint-disable-next-line no-console
    console.groupEnd?.();
    return next;
  };
}

// Ative o logger incluindo-o aqui (apenas quando precisar):
const metaReducers = environment.production ? [] : [
  // loggerMetaReducer,
];

@NgModule({
  imports: [
    StoreModule.forRoot(reducers, {
      metaReducers,
      runtimeChecks: {
        strictStateImmutability: true,
        strictActionImmutability: true,
        strictStateSerializability: true,
        strictActionSerializability: true,
      },
    }),

    // EFFECTS ROOT
    EffectsModule.forRoot([
      // USER
      AuthEffects,
      UserEffects,
      FileEffects,
      OnlineUsersEffects,
      TermsEffects,
      UserPreferencesEffects,
      UserRoleEffects,
      AuthSessionSyncEffects,
      AuthStatusSyncEffects,

      // CHAT
      ChatEffects,
      InviteEffects,
      RoomEffects,

      // INTERACTIONS - FRIENDS
      FriendsNetworkEffects,        // ⚠️ não duplicar
      FriendsRequestsCrudEffects,
      FriendsRequestsRealtimeEffects,
      FriendsRequestsProfilesEffects,
      FriendsPaginationEffects,

      // LOCATION
      NearbyProfilesEffects,
      LocationEffects,

      // removido cache.effects.ts 
    ]),

    // 🔍 Devtools (apenas em dev) — com trace p/ facilitar debug
    StoreDevtoolsModule.instrument({
      maxAge: 50,
      logOnly: environment.production,
      trace: false, // ativar quando precisar
      traceLimit: 25,
    }),
  ],
})
export class AppStoreModule {
  constructor() {
    if (!environment.production) {
      // eslint-disable-next-line no-console
      console.log('[NgRx] AppStoreModule inicializado com reducers, effects, runtimeChecks e DevTools (trace ON)');
    }
  }
}/*Linha 142
 AuthSession manda no UID
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

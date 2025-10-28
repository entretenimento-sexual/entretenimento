// src/app/store/store.module.ts
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

// EFFECTS - LOCATION
import { NearbyProfilesEffects } from './effects/effects.location/nearby-profiles.effects';
import { LocationEffects } from './effects/effects.location/location.effects';

// EFFECTS - CACHE
import { CacheEffects } from './effects/cache.effects';

// REDUCERS - FEATURE
import { friendsReducer } from './reducers/reducers.interactions/friends.reduce';
import { userPreferencesReducer } from './reducers/reducers.user/user-preferences.reducer';
import { nearbyProfilesReducer, nearbyProfilesFeatureKey } from './reducers/reducers.location/nearby-profiles.reducer';
import { locationReducer } from './reducers/reducers.location/location.reducer';

/**
 * Logger inline (opcional). Deixe desativado por padrão.
 * Se precisar depurar tempo/estado por ação, ative
 * adicionando `loggerMetaReducer` ao array `metaReducers` logo abaixo.
 */
function loggerMetaReducer<S>(reducer: ActionReducer<S>): ActionReducer<S> {
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

    // FEATURE SLICES
    StoreModule.forFeature('userPreferences', userPreferencesReducer),
    StoreModule.forFeature(nearbyProfilesFeatureKey, nearbyProfilesReducer), // 'nearbyProfiles'
    StoreModule.forFeature('interactions_friends', friendsReducer),
    StoreModule.forFeature('location', locationReducer), // 👈 garante match com location.selectors

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

      // LOCATION
      NearbyProfilesEffects,
      LocationEffects,

      // CACHE
      CacheEffects,
    ]),

    // 🔍 Devtools (apenas em dev) — com trace p/ facilitar debug
    StoreDevtoolsModule.instrument({
      maxAge: 50,
      logOnly: environment.production,
      trace: true,
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
}

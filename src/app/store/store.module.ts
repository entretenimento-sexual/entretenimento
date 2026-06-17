// src/app/store/store.module.ts
// Configuração central do NgRx.
// Mantém reducers, meta-reducers, runtime checks e effects em um ponto único.
// Logs de estado não ficam embutidos aqui para evitar exposição acidental de dados.
import { NgModule } from '@angular/core';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { environment } from '../../environments/environment';

// ROOT reducers
import { reducers } from './reducers';

// metaReducers centralizados
import { metaReducers as appMetaReducers } from './reducers/meta-reducers';

// EFFECTS - USER
import { AuthEffects } from './effects/effects.user/auth.effects';
import { UserEffects } from './effects/effects.user/user.effects';
import { FileEffects } from './effects/effects.user/file.effects';
import { OnlineUsersEffects } from './effects/effects.user/online-users.effects';
import { TermsEffects } from './effects/effects.user/terms.effects';
import { UserPreferencesEffects } from './effects/effects.user/user-preferences.effects';
import { UserRoleEffects } from './effects/effects.user/user-role.effects';
import { AuthStatusSyncEffects } from './effects/effects.user/auth-status-sync.effects';
import { AuthSessionSyncEffects } from './effects/effects.user/auth-session-sync.effects';

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
import { FriendsPaginationSelectorsCacheCleanupEffects } from
  './effects/effects.interactions/friends/pagination-selectors-cache-cleanup.effects';
// EFFECTS - LOCATION
import { NearbyProfilesEffects } from './effects/effects.location/nearby-profiles.effects';
import { LocationEffects } from './effects/effects.location/location.effects';

const metaReducers = appMetaReducers;

@NgModule({
  imports: [
    StoreModule.forRoot(reducers, {
      metaReducers,
      runtimeChecks: {
        strictStateImmutability: true,
        strictActionImmutability: true,

        /**
         * Serializability:
         * Store deve receber dados serializáveis. Datas/Timestamps devem ser
         * convertidos para epoch na borda de entrada.
         */
        strictStateSerializability: true,
        strictActionSerializability: true,
      },
    }),

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

      // INTERACTIONS
      FriendsNetworkEffects,
      FriendsRequestsCrudEffects,
      FriendsRequestsRealtimeEffects,
      FriendsRequestsProfilesEffects,
      FriendsPaginationEffects,
      FriendsPaginationSelectorsCacheCleanupEffects,
      // LOCATION
      NearbyProfilesEffects,
      LocationEffects,
    ]),

    // Devtools só em dev.
    ...(environment.production
      ? []
      : [
        StoreDevtoolsModule.instrument({
          maxAge: 50,
          trace: false,
          traceLimit: 25,
        }),
      ]),
  ],
})
export class AppStoreModule { }

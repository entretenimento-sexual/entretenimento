// src/app/store/store.module.ts
import { NgModule } from '@angular/core';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { environment } from '../../environments/environment';

// ROOT reducers
import { reducers } from './reducers'; // ⬅️ Agora centralizado via index.ts
                            // e ir esvaziando o combine.reduce substituído por reducers/index.ts

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

// EFFECTS - INTERACTIONS
import { FriendsEffects } from './effects/effects.interactions/effects.friends';

// EFFECTS - LOCATION
import { NearbyProfilesEffects } from './effects/effects.location/nearby-profiles.effects';
import { LocationEffects } from './effects/effects.location/location.effects';

// EFFECTS - CACHE
import { CacheEffects } from './effects/cache.effects';

// REDUCERS - FEATURE
import { friendsReducer } from './reducers/reducers.interactions/friends.reduce';
import { userPreferencesReducer } from './reducers/reducers.user/user-preferences.reducer';
import { nearbyProfilesReducer } from './reducers/reducers.location/nearby-profiles.reducer';

// 🔧 Feature slice names devem bater com seus selectors!
@NgModule({
  imports: [
    StoreModule.forRoot(reducers),

    // FEATURE SLICES
    StoreModule.forFeature('friends', friendsReducer),
    StoreModule.forFeature('userPreferences', userPreferencesReducer),
    StoreModule.forFeature('locationNearbyProfiles', nearbyProfilesReducer),

    // EFFECTS ROOT
    EffectsModule.forRoot([
      AuthEffects,
      UserEffects,
      FileEffects,
      OnlineUsersEffects,
      TermsEffects,
      ChatEffects,
      InviteEffects,
      RoomEffects,
      CacheEffects,
      NearbyProfilesEffects,
      LocationEffects,
      UserPreferencesEffects,
      FriendsEffects,
      UserRoleEffects,
      AuthStatusSyncEffects,
    ]),

    // 🔍 Devtools (apenas em dev)
    StoreDevtoolsModule.instrument({
      maxAge: 25,
      logOnly: environment.production,
    }),
  ],
})
export class AppStoreModule {
  constructor() {
    if (!environment.production) {
      console.log('[NgRx] AppStoreModule inicializado com reducers e effects');
    }
  }
}


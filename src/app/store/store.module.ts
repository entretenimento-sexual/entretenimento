// src/app/store/store.module.ts
import { NgModule } from '@angular/core';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { environment } from '../../environments/environment';

import { AuthEffects } from './effects/effects.user/auth.effects';
import { UserEffects } from './effects/effects.user/user.effects';
import { FileEffects } from './effects/effects.user/file.effects';
import { OnlineUsersEffects } from './effects/effects.user/online-users.effects';
import { TermsEffects } from './effects/effects.user/terms.effects';
import { ChatEffects } from './effects/effects.chat/chat.effects';
import { InviteEffects } from './effects/effects.chat/invite.effects';
import { RoomEffects } from './effects/effects.chat/room.effects';

import { reducers } from './reducers/reducers.user/combine.reducers';
import { CacheEffects } from './effects/cache.effects';

import { userPreferencesReducer } from './reducers/reducers.user/user-preferences.reducer';
import { UserPreferencesEffects } from './effects/effects.user/user-preferences.effects';
import { friendsReducer } from './reducers/reducers.interactions/friends.reduce';
import { FriendsEffects } from './effects/effects.interactions/effects.friends';

console.log('Configurações do Store carregadas');

@NgModule({
  imports: [
    StoreModule.forRoot(reducers),
    StoreModule.forFeature('friends', friendsReducer),
    StoreModule.forFeature('userPreferences', userPreferencesReducer),
    EffectsModule.forRoot([ AuthEffects, UserEffects, FileEffects, OnlineUsersEffects,
                            TermsEffects, ChatEffects, InviteEffects, RoomEffects,  CacheEffects,
                          ]),
    EffectsModule.forFeature([UserPreferencesEffects, FriendsEffects]),
    StoreDevtoolsModule.instrument({
      maxAge: 25,
      logOnly: environment.production,
    })
  ]
})
export class AppStoreModule {
  constructor() {
    console.log('Módulo AppStore inicializado');
  }
}

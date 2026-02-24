// src/app/store/store.module.ts
// Não esqueça os comentários explicativos sobre a configuração do StoreModule, EffectsModule e StoreDevtoolsModule, especialmente sobre os meta-reducers e runtime checks. Isso ajuda a contextualizar as escolhas feitas e a orientar futuros desenvolvedores que possam trabalhar nesse código.
// - O StoreModule é configurado com os reducers e meta-reducers, garantindo a imutabilidade e serializabilidade do estado e das ações.
// - O EffectsModule registra todos os efeitos relacionados a usuários, chat, interações e localização, centralizando a lógica de efeitos colaterais da aplicação.
// - O StoreDevtoolsModule é incluído apenas em ambiente de desenvolvimento para facilitar o debug do estado e das ações.
import { NgModule } from '@angular/core';
import { StoreModule, ActionReducer } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { environment } from '../../environments/environment';

// ROOT reducers
import { reducers } from './reducers';

// ✅ metaReducers centralizados
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

/**
 * Logger meta-reducer (opcional) — DEV only.
 * - Deixe comentado na maioria do tempo.
 * - Quando precisar rastrear ação/estado, ative no array final.
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

/**
 * Meta reducers finais:
 * - Em prod: somente os metaReducers do app.
 * - Em dev: pode adicionar logger por fora (para enxergar inclusive os resets).
 *
 * Observação de ordem:
 * - logger primeiro => ele “envolve” os demais e loga o resultado final.
 */
const metaReducers = environment.production
  ? appMetaReducers
  : [
    // loggerMetaReducer,
    ...appMetaReducers,
  ];

@NgModule({
  imports: [
    StoreModule.forRoot(reducers, {
      metaReducers,
      runtimeChecks: {
        strictStateImmutability: true,
        strictActionImmutability: true,

        /**
         * ⚠️ Serializability:
         * Se você guardar Timestamp/Date na Store, isso pode falhar.
         * O ideal (padrão grande) é guardar epoch(number) e converter na borda (converter/repository).
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
      FriendsNetworkEffects, // ⚠️ não duplicar
      FriendsRequestsCrudEffects,
      FriendsRequestsRealtimeEffects,
      FriendsRequestsProfilesEffects,
      FriendsPaginationEffects,
      FriendsPaginationSelectorsCacheCleanupEffects,
      // LOCATION
      NearbyProfilesEffects,
      LocationEffects,
    ]),

    // Devtools só em dev
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
export class AppStoreModule {
  constructor() {
    if (!environment.production) {
      // eslint-disable-next-line no-console
      console.log('[NgRx] AppStoreModule inicializado (reducers/effects/runtimeChecks/devtools).');
    }
  }
}

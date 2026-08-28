// src/app/store/store.module.ts
// Configuração central do NgRx.
// Mantém reducers, meta-reducers, runtime checks e effects globais em um ponto único.
// Logs de estado não ficam embutidos aqui para evitar exposição acidental de dados.
import { NgModule } from '@angular/core';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
import { environment } from '../../environments/environment';

import { reducers } from './reducers';
import { metaReducers as appMetaReducers } from './reducers/meta-reducers';

// EFFECTS - USER
import { AuthEffects } from './effects/effects.user/auth.effects';
import { UserEffects } from './effects/effects.user/user.effects';
import { OnlineUsersEffects } from './effects/effects.user/online-users.effects';
import { AuthStatusSyncEffects } from './effects/effects.user/auth-status-sync.effects';
import { AuthSessionSyncEffects } from './effects/effects.user/auth-session-sync.effects';

// EFFECTS - MESSAGING GLOBAL
// InviteEffects permanece no root porque o LayoutShell mantém o badge ativo
// em todas as rotas autenticadas.
import { InviteEffects } from './effects/effects.chat/invite.effects';

// EFFECTS - INTERACTIONS - FRIENDS
import { FriendsRequestsCrudEffects } from './effects/effects.interactions/friends/requests-crud.effects';
import { FriendsNetworkEffects } from './effects/effects.interactions/friends/network.effects';
import { FriendsRequestsProfilesEffects } from './effects/effects.interactions/friends/requests-profiles.effects';
import { FriendsRequestsRealtimeEffects } from './effects/effects.interactions/friends/requests-realtime.effects';
import { FriendsPaginationEffects } from './effects/effects.interactions/friends/pagination.effects';
import { FriendsPaginationSelectorsCacheCleanupEffects } from
  './effects/effects.interactions/friends/pagination-selectors-cache-cleanup.effects';

const metaReducers = appMetaReducers;

/**
 * Effects que precisam existir durante toda a sessão da aplicação.
 *
 * SUPRESSÕES EXPLÍCITAS DO BOOTSTRAP GLOBAL:
 * - UserRoleEffects foi removido: role/tier de assinatura são projeções do
 *   entitlement e não possuem mais caminho de escrita pelo cliente;
 * - ChatEffects foi removido: DirectChatFacade/DirectThreadFacade são os owners
 *   reativos atuais e vinculam listeners e seleção ao UID da sessão;
 * - RoomEffects foi removido: salas pertencem a RoomService,
 *   RoomFirestoreGateway e RoomManagementService/Cloud Functions;
 * - NearbyProfilesEffects pertence ao LayoutModule lazy;
 * - DiscoveryFeedEffects pertence ao DashboardModule lazy;
 * - FileEffects é legado e os fluxos modernos mantêm File em services;
 * - TermsEffects simulava persistência; o owner é TermsAcceptanceService;
 * - LocationEffects não possui effects;
 * - UserPreferencesEffects duplicava UserPreferencesService.
 */
export const ROOT_EFFECTS = [
  // USER
  AuthEffects,
  UserEffects,
  OnlineUsersEffects,
  AuthSessionSyncEffects,
  AuthStatusSyncEffects,

  // MESSAGING GLOBAL
  InviteEffects,

  // INTERACTIONS
  FriendsNetworkEffects,
  FriendsRequestsCrudEffects,
  FriendsRequestsRealtimeEffects,
  FriendsRequestsProfilesEffects,
  FriendsPaginationEffects,
  FriendsPaginationSelectorsCacheCleanupEffects,
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

    EffectsModule.forRoot(ROOT_EFFECTS),

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
export class AppStoreModule {}

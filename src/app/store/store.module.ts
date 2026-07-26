// src/app/store/store.module.ts
// Configuração central do NgRx.
// Mantém reducers, meta-reducers, runtime checks e effects globais em um ponto único.
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

// EFFECTS - CHAT GLOBAL
// InviteEffects permanece no root porque o LayoutShell mantém o badge de convites
// ativo em todas as rotas autenticadas.
import { InviteEffects } from './effects/effects.chat/invite.effects';

// EFFECTS - INTERACTIONS - FRIENDS
import { FriendsRequestsCrudEffects } from './effects/effects.interactions/friends/requests-crud.effects';
import { FriendsNetworkEffects } from './effects/effects.interactions/friends/network.effects';
import { FriendsRequestsProfilesEffects } from './effects/effects.interactions/friends/requests-profiles.effects';
import { FriendsRequestsRealtimeEffects } from './effects/effects.interactions/friends/requests-realtime.effects';
import { FriendsPaginationEffects } from './effects/effects.interactions/friends/pagination.effects';
import { FriendsPaginationSelectorsCacheCleanupEffects } from
  './effects/effects.interactions/friends/pagination-selectors-cache-cleanup.effects';

// EFFECTS - LOCATION GLOBAL
// LocationEffects permanece global porque mantém o estado de localização da
// sessão. NearbyProfilesEffects pertence ao fluxo legado lazy de perfis próximos.
import { LocationEffects } from './effects/effects.location/location.effects';

const metaReducers = appMetaReducers;

/**
 * Effects que precisam existir durante toda a sessão da aplicação.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - ChatEffects e RoomEffects não são mais registrados no root.
 * - NearbyProfilesEffects não é mais registrado no root.
 * - DiscoveryFeedEffects não é mais registrado no root.
 *
 * Motivo:
 * - ChatEffects e RoomEffects pertencem exclusivamente à rota lazy `/chat`;
 * - NearbyProfilesEffects é acionado somente pelo fluxo legado de perfis
 *   próximos, preservado dentro do LayoutModule lazy;
 * - DiscoveryFeedEffects atende somente a descoberta paginada do DashboardModule;
 * - manter esses effects aqui carregava serviços de conversa, salas, consulta
 *   geográfica e descoberta antes de o usuário acessar as respectivas áreas;
 * - os registros foram preservados nos módulos lazy correspondentes.
 */
export const ROOT_EFFECTS = [
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

  // CHAT GLOBAL
  InviteEffects,

  // INTERACTIONS
  FriendsNetworkEffects,
  FriendsRequestsCrudEffects,
  FriendsRequestsRealtimeEffects,
  FriendsRequestsProfilesEffects,
  FriendsPaginationEffects,
  FriendsPaginationSelectorsCacheCleanupEffects,

  // LOCATION GLOBAL
  LocationEffects,
];

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

    EffectsModule.forRoot(ROOT_EFFECTS),

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

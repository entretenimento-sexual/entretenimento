// src/app/store/reducers/meta-reducers/reset-store-on-auth-change.metareducer.ts
// Limpa projeções globais vinculadas à identidade anterior.
import { type ActionReducer, type MetaReducer } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { STORE_FEATURE } from '../feature-keys';

import {
  authSessionChanged,
} from '../../actions/actions.user/auth.actions';

import { initialLocationState } from '../../states/states.location/location.state';
import { initialNearbyProfilesState } from '../../states/states.location/nearby-profiles.state';
import { initialDiscoveryFeedState } from '../../states/states.discovery/discovery-feed.state';
import { initialCommunityDiscoveryCacheState } from '../../states/states.discovery/community-discovery-cache.state';
import { initialFriendsPaginationState } from '../../states/states.interactions/friends-pagination.state';
import { initialState as initialFriendsState } from '../../states/states.interactions/friends.state';
import { initialUserState } from '../../states/states.user/user.state';
import { initialFileState } from '../../states/states.user/file.state';
import { initialUserPreferencesState } from '../../states/states.user/user-preferences.state';

/**
 * Limpa toda projeção vinculada à identidade anterior.
 *
 * Autoridade única para a transição:
 * - `authSessionChanged`, produzido a partir de AuthSessionService.
 * - no início do logout, AuthSessionService mascara o UID operacional como null;
 * - na troca direta de conta, UID A -> UID B também passa por este mesmo caminho.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - removida a reação a `logoutSuccess`.
 *
 * Motivo:
 * - `logoutSuccess` era uma action paralela sem garantia de Firebase signOut;
 * - resetar exclusivamente por mudança do UID canônico cobre logout, hard signout,
 *   expiração e troca de conta sem criar uma segunda verdade.
 *
 * discoveryFeeds e communityDiscoveryCache são user-scoped porque podem
 * refletir preferências, localização, bloqueios, membership e elegibilidade
 * da conta autenticada. O cache recebe o viewerUid da própria action canônica;
 * nenhum watcher paralelo é responsável por purgar dados entre contas.
 *
 * Chats diretos e salas não aparecem neste reset porque não possuem slice
 * global. Suas facades reabrem os listeners com escopo explícito de UID e emitem
 * estado vazio antes do primeiro snapshot da nova sessão.
 *
 * O aceite jurídico também não possui slice NgRx: TermsAcceptanceService grava
 * pela Function canônica e CurrentUserStoreService recebe a projeção persistida.
 * O antigo estado booleano local foi retirado para não competir com essa fonte.
 */
function resetUserScopedSlices(
  nextState: AppState,
  viewerUid: string | null
): AppState {
  return {
    ...nextState,

    [STORE_FEATURE.user]: initialUserState as any,
    [STORE_FEATURE.file]: initialFileState as any,
    [STORE_FEATURE.userPreferences]: initialUserPreferencesState as any,


    [STORE_FEATURE.location]: initialLocationState as any,
    [STORE_FEATURE.nearbyProfiles]: initialNearbyProfilesState as any,
    [STORE_FEATURE.discoveryFeeds]: initialDiscoveryFeedState as any,
    [STORE_FEATURE.communityDiscoveryCache]: {
      ...initialCommunityDiscoveryCacheState,
      activeViewerUid: viewerUid,
    } as any,

    [STORE_FEATURE.friendsPages]: initialFriendsPaginationState as any,
    [STORE_FEATURE.interactionsFriends]: initialFriendsState as any,
  };
}

export const resetStoreOnAuthChangeMetaReducer: MetaReducer<AppState> =
  (reducer: ActionReducer<AppState>): ActionReducer<AppState> => {
    return (state, action) => {
      const nextState = reducer(state, action);

      if (action.type === authSessionChanged.type) {
        const previousUid =
          (state as any)?.[STORE_FEATURE.auth]?.userId ?? null;
        const currentUid = (action as any)?.uid ?? null;

        if (previousUid !== currentUid) {
          return resetUserScopedSlices(nextState, currentUid);
        }
      }

      return nextState;
    };
  };

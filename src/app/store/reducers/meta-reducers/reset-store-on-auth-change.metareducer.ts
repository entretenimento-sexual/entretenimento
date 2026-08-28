// src/app/store/reducers/meta-reducers/reset-store-on-auth-change.metareducer.ts
// Limpa projeções globais vinculadas à identidade anterior.
import { type ActionReducer, type MetaReducer } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { STORE_FEATURE } from '../feature-keys';

import {
  authSessionChanged,
  logoutSuccess,
} from '../../actions/actions.user/auth.actions';

import { initialInviteState } from '../../states/states.chat/invite.state';
import { initialLocationState } from '../../states/states.location/location.state';
import { initialNearbyProfilesState } from '../../states/states.location/nearby-profiles.state';
import { initialDiscoveryFeedState } from '../../states/states.discovery/discovery-feed.state';
import { initialFriendsPaginationState } from '../../states/states.interactions/friends-pagination.state';
import { initialState as initialFriendsState } from '../../states/states.interactions/friends.state';
import { initialUserState } from '../../states/states.user/user.state';
import { initialTermsState } from '../../states/states.user/terms.state';
import { initialFileState } from '../../states/states.user/file.state';
import { initialUserPreferencesState } from '../../states/states.user/user-preferences.state';

/**
 * Limpa toda projeção vinculada à identidade anterior.
 *
 * discoveryFeeds é user-scoped porque pode refletir preferências, localização,
 * bloqueios e elegibilidade da conta autenticada.
 *
 * Chats diretos e salas não aparecem neste reset porque não possuem slice
 * global. Suas facades reabrem os listeners com escopo explícito de UID e emitem
 * estado vazio antes do primeiro snapshot da nova sessão.
 */
function resetUserScopedSlices(nextState: AppState): AppState {
  return {
    ...nextState,

    [STORE_FEATURE.user]: initialUserState as any,
    [STORE_FEATURE.terms]: initialTermsState as any,
    [STORE_FEATURE.file]: initialFileState as any,
    [STORE_FEATURE.userPreferences]: initialUserPreferencesState as any,

    [STORE_FEATURE.invite]: initialInviteState as any,

    [STORE_FEATURE.location]: initialLocationState as any,
    [STORE_FEATURE.nearbyProfiles]: initialNearbyProfilesState as any,
    [STORE_FEATURE.discoveryFeeds]: initialDiscoveryFeedState as any,

    [STORE_FEATURE.friendsPages]: initialFriendsPaginationState as any,
    [STORE_FEATURE.interactionsFriends]: initialFriendsState as any,
  };
}

export const resetStoreOnAuthChangeMetaReducer: MetaReducer<AppState> =
  (reducer: ActionReducer<AppState>): ActionReducer<AppState> => {
    return (state, action) => {
      const nextState = reducer(state, action);

      if (action.type === logoutSuccess.type) {
        return resetUserScopedSlices(nextState);
      }

      if (action.type === authSessionChanged.type) {
        const previousUid =
          (state as any)?.[STORE_FEATURE.auth]?.userId ?? null;
        const currentUid = (action as any)?.uid ?? null;

        if (previousUid !== currentUid) {
          return resetUserScopedSlices(nextState);
        }
      }

      return nextState;
    };
  };

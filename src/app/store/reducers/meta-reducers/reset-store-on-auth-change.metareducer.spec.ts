// src/app/store/reducers/meta-reducers/reset-store-on-auth-change.metareducer.spec.ts
import { ActionReducer } from '@ngrx/store';

import { authSessionChanged } from '../../actions/actions.user/auth.actions';
import { initialInviteState } from '../../states/states.chat/invite.state';
import { initialDiscoveryFeedState } from '../../states/states.discovery/discovery-feed.state';
import { initialFriendsPaginationState } from '../../states/states.interactions/friends-pagination.state';
import { initialState as initialFriendsState } from '../../states/states.interactions/friends.state';
import { initialLocationState } from '../../states/states.location/location.state';
import { initialNearbyProfilesState } from '../../states/states.location/nearby-profiles.state';
import { initialFileState } from '../../states/states.user/file.state';
import { initialTermsState } from '../../states/states.user/terms.state';
import { initialUserPreferencesState } from '../../states/states.user/user-preferences.state';
import { initialUserState } from '../../states/states.user/user.state';
import { AppState } from '../../states/app.state';
import { STORE_FEATURE } from '../feature-keys';
import { resetStoreOnAuthChangeMetaReducer } from './reset-store-on-auth-change.metareducer';

function buildState(uid: string): AppState {
  /**
   * Fixture deliberadamente parcial, mas agora preenche todos os slices que o
   * meta-reducer declara user-scoped. Cada sentinel representa dados da conta
   * anterior e permite detectar regressão de vazamento entre sessões.
   */
  return {
    [STORE_FEATURE.auth]: {
      ready: true,
      isAuthenticated: true,
      userId: uid,
      emailVerified: true,
      loading: false,
      error: null,
    },
    [STORE_FEATURE.user]: { __previous: 'user' } as any,
    [STORE_FEATURE.terms]: { __previous: 'terms' } as any,
    [STORE_FEATURE.file]: { __previous: 'file' } as any,
    [STORE_FEATURE.userPreferences]: { __previous: 'preferences' } as any,
    [STORE_FEATURE.invite]: { __previous: 'invite' } as any,
    [STORE_FEATURE.location]: { __previous: 'location' } as any,
    [STORE_FEATURE.nearbyProfiles]: { __previous: 'nearby' } as any,
    [STORE_FEATURE.discoveryFeeds]: { __previous: 'discovery' } as any,
    [STORE_FEATURE.friendsPages]: { __previous: 'friends-pages' } as any,
    [STORE_FEATURE.interactionsFriends]: { __previous: 'friends' } as any,
  } as unknown as AppState;
}

function expectUserScopedSlicesReset(next: AppState): void {
  expect(next[STORE_FEATURE.user]).toEqual(initialUserState);
  expect(next[STORE_FEATURE.terms]).toEqual(initialTermsState);
  expect(next[STORE_FEATURE.file]).toEqual(initialFileState);
  expect(next[STORE_FEATURE.userPreferences]).toEqual(initialUserPreferencesState);
  expect(next[STORE_FEATURE.invite]).toEqual(initialInviteState);
  expect(next[STORE_FEATURE.location]).toEqual(initialLocationState);
  expect(next[STORE_FEATURE.nearbyProfiles]).toEqual(initialNearbyProfilesState);
  expect(next[STORE_FEATURE.discoveryFeeds]).toEqual(initialDiscoveryFeedState);
  expect(next[STORE_FEATURE.friendsPages]).toEqual(initialFriendsPaginationState);
  expect(next[STORE_FEATURE.interactionsFriends]).toEqual(initialFriendsState);
}

describe('resetStoreOnAuthChangeMetaReducer', () => {
  const passthroughReducer: ActionReducer<AppState> = (state) =>
    state as AppState;
  const reducer = resetStoreOnAuthChangeMetaReducer(passthroughReducer);

  it('limpa todos os slices user-scoped quando o UID operacional cai para null', () => {
    const state = buildState('user-a');

    const next = reducer(
      state,
      authSessionChanged({ uid: null, emailVerified: false })
    );

    expectUserScopedSlicesReset(next);
  });

  it('limpa todos os slices user-scoped quando há troca direta de conta', () => {
    const state = buildState('user-a');

    const next = reducer(
      state,
      authSessionChanged({ uid: 'user-b', emailVerified: true })
    );

    expectUserScopedSlicesReset(next);
  });

  it('preserva os slices quando a sessão emite o mesmo UID', () => {
    const state = buildState('user-a');

    const next = reducer(
      state,
      authSessionChanged({ uid: 'user-a', emailVerified: false })
    );

    expect(next[STORE_FEATURE.user]).toBe(state[STORE_FEATURE.user]);
    expect(next[STORE_FEATURE.userPreferences]).toBe(
      state[STORE_FEATURE.userPreferences]
    );
    expect(next[STORE_FEATURE.discoveryFeeds]).toBe(
      state[STORE_FEATURE.discoveryFeeds]
    );
    expect(next[STORE_FEATURE.interactionsFriends]).toBe(
      state[STORE_FEATURE.interactionsFriends]
    );
  });
});

// src/app/store/reducers/meta-reducers/reset-store-on-auth-change.metareducer.spec.ts
import { ActionReducer } from '@ngrx/store';

import {
  authSessionChanged,
  logoutSuccess,
} from '../../actions/actions.user/auth.actions';
import {
  emptyDiscoveryFeedSlice,
  initialDiscoveryFeedState,
} from '../../states/states.discovery/discovery-feed.state';
import { AppState } from '../../states/app.state';
import { STORE_FEATURE } from '../feature-keys';
import { resetStoreOnAuthChangeMetaReducer } from './reset-store-on-auth-change.metareducer';

function buildState(uid: string): AppState {
  return {
    [STORE_FEATURE.auth]: {
      ready: true,
      isAuthenticated: true,
      userId: uid,
      emailVerified: true,
      loading: false,
      error: null,
    },
    [STORE_FEATURE.discoveryFeeds]: {
      byQuery: {
        'previous-user-feed': {
          ...emptyDiscoveryFeedSlice,
          items: [{ uid: 'profile-from-previous-user' } as any],
          lastLoadedAt: 123,
        },
      },
    },
  } as AppState;
}

describe('resetStoreOnAuthChangeMetaReducer', () => {
  const passthroughReducer: ActionReducer<AppState> = (state) =>
    state as AppState;
  const reducer = resetStoreOnAuthChangeMetaReducer(passthroughReducer);

  it('limpa discoveryFeeds no logout', () => {
    const state = buildState('user-a');

    const next = reducer(state, logoutSuccess());

    expect(next[STORE_FEATURE.discoveryFeeds]).toEqual(
      initialDiscoveryFeedState
    );
  });

  it('limpa discoveryFeeds quando o UID autenticado muda', () => {
    const state = buildState('user-a');

    const next = reducer(
      state,
      authSessionChanged({ uid: 'user-b', emailVerified: true })
    );

    expect(next[STORE_FEATURE.discoveryFeeds]).toEqual(
      initialDiscoveryFeedState
    );
  });

  it('preserva discoveryFeeds quando a sessão emite o mesmo UID', () => {
    const state = buildState('user-a');
    const previousDiscovery = state[STORE_FEATURE.discoveryFeeds];

    const next = reducer(
      state,
      authSessionChanged({ uid: 'user-a', emailVerified: false })
    );

    expect(next[STORE_FEATURE.discoveryFeeds]).toBe(previousDiscovery);
  });
});

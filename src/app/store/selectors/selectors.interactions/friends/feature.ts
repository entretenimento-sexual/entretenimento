// src/app/store/selectors/selectors.interactions/friends/feature.ts
import { createSelector } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { FriendsState, initialState } from '../../../states/states.interactions/friends.state';

export const FRIENDS_FEATURE_KEY = 'interactions_friends' as const;

// root selector (padrão mais estável no seu setup)
export const selectFriendsState = (s: AppState): FriendsState =>
  s?.interactions_friends ?? initialState;

// ✅ compat: mantém os selectors existentes funcionando
export const selectFriendsStateSafe = selectFriendsState;

export const selectRequestersMap = createSelector(
  selectFriendsState,
  (s) => s.requestersMap
);

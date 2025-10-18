// src/app/store/selectors/selectors.interactions/friends/feature.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { FriendsState, initialState } from '../../../states/states.interactions/friends.state';
import { selectInboundRequests } from './inbound.selectors';

export const FRIENDS_FEATURE_KEY = 'interactions_friends' as const;

export const selectFriendsState =
  createFeatureSelector<FriendsState>(FRIENDS_FEATURE_KEY);

export const selectFriendsStateSafe = createSelector(
  selectFriendsState,
  (s) => s ?? initialState
);

export const selectRequestersMap = createSelector(
  selectFriendsStateSafe,
  s => s.requestersMap
);



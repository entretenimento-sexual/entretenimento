// src/app/store/selectors/selectors.interactions/friends/settings.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectFriendsStateSafe } from './feature';

export const selectFriendSettings = createSelector(
  selectFriendsStateSafe,
  (state) => state.settings
);

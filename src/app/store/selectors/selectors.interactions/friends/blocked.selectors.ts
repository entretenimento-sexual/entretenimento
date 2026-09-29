// src/app/store/selectors/selectors.interactions/friends/blocked.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectFriendsStateSafe } from './feature';

export const selectBlockedFriends = createSelector(
  selectFriendsStateSafe, s => s.blocked
);
export const selectBlockedLoading = createSelector(
  selectFriendsStateSafe, s => s.loadingBlocked
);

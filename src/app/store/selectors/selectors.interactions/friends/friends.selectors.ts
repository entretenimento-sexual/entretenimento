// src/app/store/selectors/selectors.interactions/friends/friends.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectFriendsStateSafe } from './feature';

export const selectFriends = createSelector(
  selectFriendsStateSafe, s => s.friends
);
export const selectAllFriends = createSelector(
  selectFriends, f => Array.isArray(f) ? f : []
);

export const selectFriendsLoading = createSelector(
  selectFriendsStateSafe, s => s.loading
);


export const selectEndingFriendshipUid = createSelector(
  selectFriendsStateSafe,
  s => s.endingFriendshipUid ?? null
);


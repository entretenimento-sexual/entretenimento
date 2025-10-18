// src/app/store/selectors/selectors.interactions/friends/friends.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectFriendsStateSafe } from './feature';

export const selectFriends = createSelector(
  selectFriendsStateSafe, s => s.friends
);
export const selectAllFriends = createSelector(
  selectFriends, f => Array.isArray(f) ? f : []
);
export const selectFriendsCount = createSelector(
  selectAllFriends, f => f.length
);

export const selectFriendsLoading = createSelector(
  selectFriendsStateSafe, s => s.loading
);
export const selectFriendsError = createSelector(
  selectFriendsStateSafe, s => s.error ?? null
);
export const selectAnyFriendsError = createSelector(
  selectFriendsStateSafe, s => s.error ?? s.sendFriendRequestError ?? s.blockError ?? null
);
export const selectSendFriendRequestError = createSelector(
  selectFriendsStateSafe,
  s => s.sendFriendRequestError ?? null
);

export const selectSendFriendRequestSuccess = createSelector(
  selectFriendsStateSafe,
  s => !!s.sendFriendRequestSuccess
);

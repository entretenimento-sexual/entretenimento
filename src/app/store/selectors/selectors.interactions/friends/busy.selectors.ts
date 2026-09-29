// src/app/store/selectors/selectors.interactions/friends/busy.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectFriendsStateSafe } from './feature';

export const selectIsSendingFriendRequest = createSelector(
  selectFriendsStateSafe, s => s.sendingFriendRequest
);


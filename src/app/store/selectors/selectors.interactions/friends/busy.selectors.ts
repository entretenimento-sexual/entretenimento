// src/app/store/selectors/selectors.interactions/friends/busy.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectFriendsLoading } from './friends.selectors';
import { selectRequestsLoading } from './inbound.selectors';
import { selectOutboundRequestsLoading } from './outbound.selectors';
import { selectBlockedLoading } from './blocked.selectors';
import { selectFriendsStateSafe } from './feature';

export const selectIsSendingFriendRequest = createSelector(
  selectFriendsStateSafe, s => s.sendingFriendRequest
);

export const selectFriendsBusy = createSelector(
  selectFriendsLoading,
  selectRequestsLoading,
  selectOutboundRequestsLoading,
  selectBlockedLoading,
  selectIsSendingFriendRequest,
  (...flags) => flags.some(Boolean)
);

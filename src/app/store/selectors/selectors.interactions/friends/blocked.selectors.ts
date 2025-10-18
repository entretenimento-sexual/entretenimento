// src/app/store/selectors/selectors.interactions/friends/blocked.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectFriendsStateSafe } from './feature';

export const selectBlockedFriends = createSelector(
  selectFriendsStateSafe, s => s.blocked
);
export const selectBlockedFriendsCount = createSelector(
  selectBlockedFriends, b => b?.length ?? 0
);
export const selectBlockedLoading = createSelector(
  selectFriendsStateSafe, s => s.loadingBlocked
);
export const selectBlockError = createSelector(
  selectFriendsStateSafe, s => s.blockError
);

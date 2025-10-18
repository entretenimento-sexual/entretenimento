// src/app/store/selectors/selectors.interactions/friends/search.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectFriendsStateSafe } from './feature';

export const selectFriendSearchResults = createSelector(
  selectFriendsStateSafe, s => s.searchResults ?? []
);
export const selectHasFriendSearchResults = createSelector(
  selectFriendSearchResults, r => (r?.length ?? 0) > 0
);

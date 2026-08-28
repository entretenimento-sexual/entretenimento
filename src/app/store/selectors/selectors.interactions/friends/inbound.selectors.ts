// src/app/store/selectors/selectors.interactions/friends/inbound.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectFriendsStateSafe } from './feature';

export const selectInboundRequests = createSelector(
  selectFriendsStateSafe, s => s.requests
);
export const selectInboundRequestsCount = createSelector(
  selectInboundRequests, r => r?.length ?? 0
);
export const selectRequestsLoading = createSelector(
  selectFriendsStateSafe, s => s.loadingRequests
);

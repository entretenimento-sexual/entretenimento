// src/app/store/selectors/selectors.interactions/friends/outbound.selectors.ts
import { createSelector } from '@ngrx/store';
import { selectFriendsStateSafe } from './feature';

export const selectOutboundRequests = createSelector(
  selectFriendsStateSafe, s => s.outboundRequests
);
export const selectOutboundRequestsCount = createSelector(
  selectOutboundRequests, r => r?.length ?? 0
);
export const selectOutboundRequestsLoading = createSelector(
  selectFriendsStateSafe, s => s.loadingOutboundRequests
);

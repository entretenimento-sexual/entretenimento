// src/app/store/selectors/selectors.chat/invite.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';

import { STORE_FEATURE } from '../../reducers/feature-keys';
import { InviteState } from '../../states/states.chat/invite.state';

export const selectInviteState =
  createFeatureSelector<InviteState>(STORE_FEATURE.invite);

export const selectInviteOwnerUid = createSelector(
  selectInviteState,
  (state) => state.ownerUid
);

export const selectInvites = createSelector(
  selectInviteState,
  (state) => state.invites
);

export const selectInvitesLoading = createSelector(
  selectInviteState,
  (state) => state.loading
);

export const selectInvitesLoaded = createSelector(
  selectInviteState,
  (state) => state.loaded
);

export const selectInvitesError = createSelector(
  selectInviteState,
  (state) => state.error
);

export const selectPendingInvites = createSelector(
  selectInvites,
  (items) => items.filter((invite) => invite.status === 'pending')
);

export const selectPendingInvitesCount = createSelector(
  selectPendingInvites,
  (items) => items.length
);

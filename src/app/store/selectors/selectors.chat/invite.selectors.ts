// src/app/store/selectors/selectors.chat/invite.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { InviteState } from '../../states/states.chat/invite.state';

export const selectInviteState = createFeatureSelector<InviteState>('invite');

export const selectInvites = createSelector(selectInviteState, s => s.invites);
export const selectInvitesLoading = createSelector(selectInviteState, s => s.loading);
export const selectInvitesError = createSelector(selectInviteState, s => s.error);

export const selectPendingInvites = createSelector(selectInvites, list => list.filter(i => i.status === 'pending'));
export const selectPendingInvitesCount = createSelector(selectPendingInvites, list => list.length);

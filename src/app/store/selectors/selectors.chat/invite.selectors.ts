// src/app/store/selectors/selectors.chat/invite.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { InviteState } from '../../states/states.chat/invite.state';

// Seletor para o estado de convites
export const selectInviteState = createFeatureSelector<InviteState>('invite');

// Selecionar todos os convites
export const selectInvites = createSelector(selectInviteState, (state) => state.invites);

// Selecionar convites pendentes
export const selectPendingInvites = createSelector(selectInvites, (invites) =>
  invites.filter((invite) => invite.status === 'pending')
);

// Selecionar um convite específico pelo ID
export const selectInviteById = (inviteId: string) =>
  createSelector(selectInvites, (invites) => invites.find((invite) => invite.id === inviteId));

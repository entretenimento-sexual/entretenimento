// src/app/store/selectors/selectors.chat/invite.selectors.ts
import { createSelector, createFeatureSelector } from '@ngrx/store';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';

// Seletor para o estado de convites
export const selectInviteState = createFeatureSelector<Invite[]>('invites');

// Seleciona todos os convites pendentes
export const selectPendingInvites = createSelector(
  selectInviteState,
  (invites: Invite[]) => invites.filter(invite => invite.status === 'pending')
);

// Seleciona um convite específico pelo ID
export const selectInviteById = (inviteId: string) => createSelector(
  selectInviteState,
  (invites: Invite[]) => invites.find(invite => invite.id === inviteId)
);

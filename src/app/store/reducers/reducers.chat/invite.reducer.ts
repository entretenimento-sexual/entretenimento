// src/app/store/reducers/reducers.chat/invite.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { initialInviteState, InviteState } from '../../states/states.chat/invite.state';
import * as InviteActions from '../../actions/actions.chat/invite.actions';

export const inviteReducer = createReducer<InviteState>(
  initialInviteState,

  on(InviteActions.LoadInvites, s => ({ ...s, loading: true, error: null })),
  on(InviteActions.LoadInvitesSuccess, (s, { invites }) => ({ ...s, loading: false, invites })),
  on(InviteActions.LoadInvitesFailure, (s, { error }) => ({ ...s, loading: false, error })),

  // ✅ atualiza somente no sucesso
  on(InviteActions.AcceptInviteSuccess, (s, { inviteId }) => ({
    ...s,
    invites: s.invites.map(i => i.id === inviteId ? { ...i, status: 'accepted' } : i),
  })),
  on(InviteActions.DeclineInviteSuccess, (s, { inviteId }) => ({
    ...s,
    invites: s.invites.map(i => i.id === inviteId ? { ...i, status: 'declined' } : i),
  })),
);

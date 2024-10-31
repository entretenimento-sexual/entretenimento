// src/app/store/reducers/reducers.chat/invite.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { initialInviteState, InviteState } from '../../states/states.chat/invite.state';
import * as InviteActions from '../../actions/actions.chat/invite.actions';

export const inviteReducer = createReducer<InviteState>(
  initialInviteState,

  // Carregar convites
  on(InviteActions.LoadInvites, (state) => ({
    ...state,
    loading: true,
    error: null
  })),
  on(InviteActions.LoadInvitesSuccess, (state, { invites }) => ({
    ...state,
    invites,
    loading: false
  })),
  on(InviteActions.LoadInvitesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error
  })),

  // Aceitar convite
  on(InviteActions.AcceptInvite, (state, { inviteId }) => ({
    ...state,
    invites: state.invites.map(invite =>
      invite.id === inviteId ? { ...invite, status: 'accepted' } : invite
    )
  })),

  // Recusar convite
  on(InviteActions.DeclineInvite, (state, { inviteId }) => ({
    ...state,
    invites: state.invites.map(invite =>
      invite.id === inviteId ? { ...invite, status: 'declined' } : invite
    )
  }))
);

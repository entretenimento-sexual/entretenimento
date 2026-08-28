// src/app/store/reducers/reducers.chat/invite.reducer.ts
import { createReducer, on } from '@ngrx/store';

import * as InviteActions from '../../actions/actions.chat/invite.actions';
import {
  initialInviteState,
  InviteState,
} from '../../states/states.chat/invite.state';

function normalizeUid(uid: string | null | undefined): string {
  return String(uid ?? '').trim();
}

function ownsState(state: InviteState, ownerUid: string): boolean {
  const safeOwnerUid = normalizeUid(ownerUid);
  return !!safeOwnerUid && state.ownerUid === safeOwnerUid;
}

function removeInvite(state: InviteState, inviteId: string): InviteState {
  const safeInviteId = String(inviteId ?? '').trim();
  if (!safeInviteId) return state;

  return {
    ...state,
    invites: state.invites.filter((invite) => invite.id !== safeInviteId),
    error: null,
  };
}

export const inviteReducer = createReducer<InviteState>(
  initialInviteState,

  /**
   * UID diferente abre escopo vazio imediatamente.
   * UID igual preserva a projeção já resolvida e apenas reativa loading quando
   * ainda não houve snapshot; isso torna shell/effect idempotentes no bootstrap.
   */
  on(InviteActions.LoadInvites, (state, { userId }): InviteState => {
    const ownerUid = normalizeUid(userId);

    if (!ownerUid) {
      return {
        ...initialInviteState,
        error: 'Sessão inválida para carregar convites.',
      };
    }

    if (state.ownerUid === ownerUid) {
      return {
        ...state,
        loading: state.loaded ? false : true,
        error: null,
      };
    }

    return {
      ...initialInviteState,
      ownerUid,
      loading: true,
    };
  }),

  on(
    InviteActions.LoadInvitesSuccess,
    (state, { ownerUid, invites }): InviteState => {
      if (!ownsState(state, ownerUid)) return state;

      return {
        ...state,
        invites: [...(invites ?? [])],
        loading: false,
        loaded: true,
        error: null,
      };
    }
  ),

  on(
    InviteActions.LoadInvitesFailure,
    (state, { ownerUid, error }): InviteState => {
      if (!ownsState(state, ownerUid)) return state;

      return {
        ...state,
        invites: [],
        loading: false,
        loaded: false,
        error,
      };
    }
  ),

  on(InviteActions.StopInvites, InviteActions.ClearInvitesState, () => ({
    ...initialInviteState,
  })),

  on(
    InviteActions.AcceptInviteSuccess,
    (state, { ownerUid, inviteId }): InviteState =>
      ownsState(state, ownerUid) ? removeInvite(state, inviteId) : state
  ),

  on(
    InviteActions.DeclineInviteSuccess,
    (state, { ownerUid, inviteId }): InviteState =>
      ownsState(state, ownerUid) ? removeInvite(state, inviteId) : state
  ),

  on(
    InviteActions.AcceptInviteFailure,
    InviteActions.DeclineInviteFailure,
    (state, { ownerUid, error }): InviteState =>
      ownsState(state, ownerUid)
        ? {
            ...state,
            error,
          }
        : state
  )
);

// src/app/store/actions/actions.chat/invite.actions.ts
import { createAction, props } from '@ngrx/store';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';

export const LoadInvites = createAction(
  '[Invite] Load Invites',
  props<{ userId: string }>() // ✅ já exigimos o userId aqui pra ficar explícito
);

export const LoadInvitesSuccess = createAction(
  '[Invite] Load Invites Success',
  props<{ invites: Invite[] }>()
);
export const LoadInvitesFailure = createAction(
  '[Invite] Load Invites Failure',
  props<{ error: string }>()
);

// ✅ Aceitar/Recusar agora só com inviteId
export const AcceptInvite = createAction(
  '[Invite] Accept Invite',
  props<{ inviteId: string }>()
);
export const AcceptInviteSuccess = createAction(
  '[Invite] Accept Invite Success',
  props<{ inviteId: string }>()
);
export const AcceptInviteFailure = createAction(
  '[Invite] Accept Invite Failure',
  props<{ error: string }>()
);

export const DeclineInvite = createAction(
  '[Invite] Decline Invite',
  props<{ inviteId: string }>()
);
export const DeclineInviteSuccess = createAction(
  '[Invite] Decline Invite Success',
  props<{ inviteId: string }>()
);
export const DeclineInviteFailure = createAction(
  '[Invite] Decline Invite Failure',
  props<{ error: string }>()
);

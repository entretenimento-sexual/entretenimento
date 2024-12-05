// src/app/store/actions/actions.chat/invite.actions.ts
import { createAction, props } from '@ngrx/store';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';

export const LoadInvites = createAction(
  '[Invite] Load Invites',
  props<{ userId: string }>()
);

export const LoadInvitesSuccess = createAction(
  '[Invite] Load Invites Success',
  props<{ invites: Invite[] }>()
);

export const LoadInvitesFailure = createAction(
  '[Invite] Load Invites Failure',
  props<{ error: string }>()
);

export const UpdateInviteStatus = createAction(
  '[Invite] Update Invite Status',
  props<{ roomId: string; inviteId: string; status: 'accepted' | 'declined' }>()
);

export const UpdateInviteStatusSuccess = createAction('[Invite] Update Invite Status Success');

export const UpdateInviteStatusFailure = createAction(
  '[Invite] Update Invite Status Failure',
  props<{ error: string }>()
);
// Accept Invite
export const AcceptInvite = createAction(
  '[Invite] Accept Invite',
  props<{ inviteId: string; roomId: string }>()
);

export const AcceptInviteSuccess = createAction(
  '[Invite] Accept Invite Success',
  props<{ inviteId: string }>()
);

export const AcceptInviteFailure = createAction(
  '[Invite] Accept Invite Failure',
  props<{ error: string }>()
);

// Decline Invite
export const DeclineInvite = createAction(
  '[Invite] Decline Invite',
  props<{ inviteId: string; roomId: string }>()
);

export const DeclineInviteSuccess = createAction(
  '[Invite] Decline Invite Success',
  props<{ inviteId: string }>()
);

export const DeclineInviteFailure = createAction(
  '[Invite] Decline Invite Failure',
  props<{ error: string }>()
);

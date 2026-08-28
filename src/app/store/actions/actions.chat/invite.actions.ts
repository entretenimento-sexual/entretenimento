// src/app/store/actions/actions.chat/invite.actions.ts
import { createAction, props } from '@ngrx/store';

import { InviteInboxItem } from 'src/app/core/interfaces/interfaces-chat/invite.interface';

export const LoadInvites = createAction(
  '[Invite] Load Invites',
  props<{ userId: string }>()
);

export const LoadInvitesSuccess = createAction(
  '[Invite] Load Invites Success',
  props<{ ownerUid: string; invites: InviteInboxItem[] }>()
);

export const LoadInvitesFailure = createAction(
  '[Invite] Load Invites Failure',
  props<{ ownerUid: string; error: string }>()
);

export const AcceptInvite = createAction(
  '[Invite] Accept Invite',
  props<{ ownerUid: string; inviteId: string }>()
);

export const AcceptInviteSuccess = createAction(
  '[Invite] Accept Invite Success',
  props<{ ownerUid: string; inviteId: string }>()
);

export const AcceptInviteFailure = createAction(
  '[Invite] Accept Invite Failure',
  props<{ ownerUid: string; inviteId: string; error: string }>()
);

export const DeclineInvite = createAction(
  '[Invite] Decline Invite',
  props<{ ownerUid: string; inviteId: string }>()
);

export const DeclineInviteSuccess = createAction(
  '[Invite] Decline Invite Success',
  props<{ ownerUid: string; inviteId: string }>()
);

export const DeclineInviteFailure = createAction(
  '[Invite] Decline Invite Failure',
  props<{ ownerUid: string; inviteId: string; error: string }>()
);

export const StopInvites = createAction('[Invite] Stop Invites');
export const ClearInvitesState = createAction('[Invite] Clear Invites State');

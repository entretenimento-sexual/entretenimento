//src\app\store\actions\actions.interactions\friends\friends-blocks.actions.ts
import { createAction, props } from '@ngrx/store';
import { BlockedUserActive } from 'src/app/core/interfaces/friendship/blocked-user.interface';

// -----------------------------
// Block / Unblock
// -----------------------------
export const blockUser = createAction(
  '[Friendship] Block User',
  props<{ ownerUid: string; targetUid: string; reason?: string }>()
);

export const blockUserSuccess = createAction(
  '[Friendship] Block User Success',
  props<{ ownerUid: string; targetUid: string }>()
);

export const blockUserFailure = createAction(
  '[Friendship] Block User Failure',
  props<{ error: string }>()
);

export const unblockUser = createAction(
  '[Friendship] Unblock User',
  props<{ ownerUid: string; targetUid: string }>()
);

export const unblockUserSuccess = createAction(
  '[Friendship] Unblock User Success',
  props<{ ownerUid: string; targetUid: string }>()
);

export const unblockUserFailure = createAction(
  '[Friendship] Unblock User Failure',
  props<{ error: string }>()
);

export const loadBlockedUsers = createAction(
  '[Friendship] Load Blocked Users',
  props<{ uid: string }>()
);

export const loadBlockedUsersSuccess = createAction(
  '[Friendship] Load Blocked Users Success',
  props<{ blocked: BlockedUserActive[] }>()
);

export const loadBlockedUsersFailure = createAction(
  '[Friendship] Load Blocked Users Failure',
  props<{ error: string }>()
);

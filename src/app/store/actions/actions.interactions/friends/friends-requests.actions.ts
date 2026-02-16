//src\app\store\actions\actions.interactions\friends\friends-requests.actions.ts
import { createAction, props } from '@ngrx/store';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';
import { UserPublic } from 'src/app/core/interfaces/user-public.interface';
// -----------------------------
// Friend Requests (inbound/outbound)
// -----------------------------
export const sendFriendRequest = createAction(
  '[Friendship] Send Request',
  props<{ requesterUid: string; targetUid: string; message?: string }>()
);

export const sendFriendRequestSuccess = createAction(
  '[Friendship] Send Request Success'
);

export const sendFriendRequestFailure = createAction(
  '[Friendship] Send Request Failure',
  props<{ error: string }>()
);

export const loadInboundRequests = createAction(
  '[Friendship] Load Inbound Requests',
  props<{ uid: string }>()
);

export const loadInboundRequestsSuccess = createAction(
  '[Friendship] Load Inbound Requests Success',
  props<{ requests: (FriendRequest & { id: string })[] }>()
);

export const loadInboundRequestsFailure = createAction(
  '[Friendship] Load Inbound Requests Failure',
  props<{ error: string }>()
);

export const loadOutboundRequests = createAction(
  '[Friendship] Load Outbound Requests',
  props<{ uid: string }>()
);

export const loadOutboundRequestsSuccess = createAction(
  '[Friendship] Load Outbound Requests Success',
  props<{ requests: (FriendRequest & { id: string })[] }>()
);

export const loadOutboundRequestsFailure = createAction(
  '[Friendship] Load Outbound Requests Failure',
  props<{ error: string }>()
);

// Cancelar enviada (outbound)
export const cancelFriendRequest = createAction(
  '[Friendship] Cancel Outbound Request',
  props<{ requestId: string }>()
);

export const cancelFriendRequestSuccess = createAction(
  '[Friendship] Cancel Outbound Request Success',
  props<{ requestId: string }>()
);

export const cancelFriendRequestFailure = createAction(
  '[Friendship] Cancel Outbound Request Failure',
  props<{ error: string }>()
);

// Aceitar / Recusar (inbound)
export const acceptFriendRequest = createAction(
  '[Friendship] Accept Request',
  props<{ requestId: string; requesterUid: string; targetUid: string }>()
);

export const acceptFriendRequestSuccess = createAction(
  '[Friendship] Accept Request Success',
  props<{ requestId: string }>()
);

export const acceptFriendRequestFailure = createAction(
  '[Friendship] Accept Request Failure',
  props<{ error: string }>()
);

export const declineFriendRequest = createAction(
  '[Friendship] Decline Request',
  props<{ requestId: string }>()
);

export const declineFriendRequestSuccess = createAction(
  '[Friendship] Decline Request Success',
  props<{ requestId: string }>()
);

export const declineFriendRequestFailure = createAction(
  '[Friendship] Decline Request Failure',
  props<{ error: string }>()
);

// Perfis mínimos dos requesters (auxiliar de VM/UIs)
export const loadRequesterProfiles = createAction(
  '[Friends] Load requester profiles',
  props<{ uids: string[] }>()
);

export const loadRequesterProfilesSuccess = createAction(
  '[Friends] Load requester profiles success',
  props<{ map: Record<string, UserPublic> }>()
);

export const loadRequesterProfilesFailure = createAction(
  '[Friends] Load requester profiles failure',
  props<{ error: any }>()
);
export const loadTargetProfiles = createAction(
  '[Friends] Load Target Profiles',
  props<{ uids: string[] }>()
);

export const loadTargetProfilesSuccess = createAction(
  '[Friends] Load Target Profiles Success',
  props<{ map: Record<string, UserPublic> }>()
);

export const loadTargetProfilesFailure = createAction(
  '[Friends] Load Target Profiles Failure',
  props<{ error: string }>()
);

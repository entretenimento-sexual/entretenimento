// src/app/store/actions/actions.interactions/actions.friends.ts
import { createAction, props } from '@ngrx/store';
import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';
import { BlockedUser } from 'src/app/core/interfaces/friendship/blocked-user.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

/**
 * Convenções adotadas:
 * - Ação base: [Domínio] Verbo Objeto
 * - Sucesso/Erro: mesma tag com sufixo "Success"/"Failure"
 * - Erros sempre em string (centraliza mapeamento no Effect)
 */

// -----------------------------
// Friends (lista do usuário)
// -----------------------------
export const loadFriends = createAction(
  '[Friendship] Load Friends',
  props<{ uid: string }>()
);

export const loadFriendsSuccess = createAction(
  '[Friendship] Load Friends Success',
  props<{ friends: Friend[] }>()
);

export const loadFriendsFailure = createAction(
  '[Friendship] Load Friends Failure',
  props<{ error: string }>()
);

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

export const loadRequesterProfiles = createAction(
  '[Friends] Load requester profiles',
  props<{ uids: string[] }>()
);
export const loadRequesterProfilesSuccess = createAction(
  '[Friends] Load requester profiles success',
  props<{ map: Record<string, { uid: string; nickname?: string; avatarUrl?: string }> }>()
);
export const loadRequesterProfilesFailure = createAction(
  '[Friends] Load requester profiles failure',
  props<{ error: any }>()
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
  props<{ blocked: BlockedUser[] }>()
);

export const loadBlockedUsersFailure = createAction(
  '[Friendship] Load Blocked Users Failure',
  props<{ error: string }>()
);

// -----------------------------
// Realtime (inbound requests)
// -----------------------------
export const startInboundRequestsListener = createAction(
  '[Friendship] Start Inbound Requests Listener',
  props<{ uid: string }>()
);

export const stopInboundRequestsListener = createAction(
  '[Friendship] Stop Inbound Requests Listener'
);

export const inboundRequestsChanged = createAction(
  '[Friendship] Inbound Requests Changed',
  props<{ requests: (FriendRequest & { id: string })[] }>()
);

// -----------------------------
// Utilitários de UI/estado local
// -----------------------------
export const resetSendFriendRequestStatus = createAction(
  '[Friendship] Reset Send Friend Request Status'
);

// Busca de usuários
export const loadSearchResults = createAction(
  '[Friendship] Load Search Results',
  props<{ searchTerm: string }>()
);

export const loadSearchResultsSuccess = createAction(
  '[Friendship] Load Search Results Success',
  props<{ results: IUserDados[] }>()
);

export const loadSearchResultsFailure = createAction(
  '[Friendship] Load Search Results Failure',
  props<{ error: string }>()
);

// Settings (preferências de amizade)
export const updateFriendSettings = createAction(
  '[Friendship] Update Friend Settings',
  props<{
    settings: {
      receiveRequests: boolean;
      showOnlineStatus: boolean;
      allowSearchByNickname: boolean;
    };
  }>()
);

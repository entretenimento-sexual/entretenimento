// src/app/store/reducers/reducers.interactions/friends.reduce.ts
import { createReducer, on } from '@ngrx/store';
import * as A from '../../actions/actions.interactions/actions.friends';
import { FriendsState, initialState } from '../../states/states.interactions/friends.state';
import { BlockedUser } from '../../../core/interfaces/friendship/blocked-user.interface';

export const friendsReducer = createReducer(
  initialState,

  /* 👥 Friends */
  on(A.loadFriends, (s): FriendsState => ({ ...s, loading: true, error: null })),
  on(A.loadFriendsSuccess, (s, { friends }): FriendsState => ({ ...s, loading: false, friends })),
  on(A.loadFriendsFailure, (s, { error }): FriendsState => ({ ...s, loading: false, error })),

  /* ✉️ Send Friend Request */
  on(A.sendFriendRequest, (s): FriendsState => ({
    ...s,
    sendingFriendRequest: true,
    sendFriendRequestError: null,
    sendFriendRequestSuccess: false,
  })),
  on(A.sendFriendRequestSuccess, (s): FriendsState => ({
    ...s,
    sendingFriendRequest: false,
    sendFriendRequestSuccess: true,
  })),
  on(A.sendFriendRequestFailure, (s, { error }): FriendsState => ({
    ...s,
    sendingFriendRequest: false,
    sendFriendRequestError: error,
    sendFriendRequestSuccess: false,
  })),
  on(A.resetSendFriendRequestStatus, (s): FriendsState => ({
    ...s,
    sendFriendRequestSuccess: false,
    sendFriendRequestError: null,
  })),

  /* 📥 Inbound (Recebidas) */
  on(A.loadInboundRequests, (s): FriendsState => ({
    ...s, loadingRequests: true, error: null
  })),
  on(A.loadInboundRequestsSuccess, (s, { requests }): FriendsState => ({
    ...s, loadingRequests: false, requests
  })),
  on(A.loadInboundRequestsFailure, (s, { error }): FriendsState => ({
    ...s, loadingRequests: false, error
  })),

  /* 📤 Outbound (Enviadas) */
  on(A.loadOutboundRequests, (s): FriendsState => ({
    ...s, loadingOutboundRequests: true, error: null
  })),
  on(A.loadOutboundRequestsSuccess, (s, { requests }): FriendsState => ({
    ...s, loadingOutboundRequests: false, outboundRequests: requests
  })),
  on(A.loadOutboundRequestsFailure, (s, { error }): FriendsState => ({
    ...s, loadingOutboundRequests: false, error
  })),

  on(A.loadRequesterProfilesSuccess, (s, { map }) => ({
    ...s,
    requestersMap: { ...s.requestersMap, ...map }
  })),

  /* ✅ Accept / Decline (limpa da lista inbound localmente) */
  on(A.acceptFriendRequestSuccess, (s, { requestId }): FriendsState => ({
    ...s,
    requests: s.requests.filter(r => r.id !== requestId),
  })),
  on(A.declineFriendRequestSuccess, (s, { requestId }): FriendsState => ({
    ...s,
    requests: s.requests.filter(r => r.id !== requestId),
  })),

  /* ❌ Cancel outbound (remove da lista enviada local) */
  on(A.cancelFriendRequestSuccess, (s, { requestId }): FriendsState => ({
    ...s,
    outboundRequests: s.outboundRequests.filter(r => r.id !== requestId),
  })),

  /* 🚫 Block list */
  // loading + sucesso + erro da lista bloqueada
  on(A.loadBlockedUsers, (s): FriendsState => ({
    ...s, loadingBlocked: true, blockError: null
  })),
  on(A.loadBlockedUsersSuccess, (s, { blocked }): FriendsState => ({
    ...s, loadingBlocked: false, blocked
  })),
  on(A.loadBlockedUsersFailure, (s, { error }): FriendsState => ({
    ...s, loadingBlocked: false, blockError: error
  })),

  // 🔒 Block (somente no Success para evitar rollback)
  on(A.blockUserSuccess, (s, { targetUid }): FriendsState => {
    const exists = s.blocked.some(b => b.uid === targetUid);
    if (exists) return { ...s, blockError: null };
    const entry: BlockedUser = { uid: targetUid, reason: undefined, blockedAt: null };
    return { ...s, blocked: [...s.blocked, entry], blockError: null };
  }),
  on(A.blockUserFailure, (s, { error }): FriendsState => ({
    ...s, blockError: error
  })),

  // 🔓 Unblock (somente no Success para evitar rollback)
  on(A.unblockUserSuccess, (s, { targetUid }): FriendsState => ({
    ...s, blocked: s.blocked.filter(b => b.uid !== targetUid), blockError: null
  })),
  on(A.unblockUserFailure, (s, { error }): FriendsState => ({
    ...s, blockError: error
  })),

  /* 🔎 Search */
  on(A.loadSearchResultsSuccess, (s, { results }): FriendsState => ({ ...s, searchResults: results })),
  on(A.loadSearchResultsFailure, (s, { error }): FriendsState => ({ ...s, error })),

  /* ⚙️ Settings */
  on(A.updateFriendSettings, (s, { settings }): FriendsState => ({ ...s, settings })),

  /* 🔴 Realtime inbound listener */
  on(A.startInboundRequestsListener, (s): FriendsState => ({
    ...s, loadingRequests: true, error: null
  })),
  on(A.inboundRequestsChanged, (s, { requests }): FriendsState => ({
    ...s, loadingRequests: false, requests
  })),
  on(A.stopInboundRequestsListener, (s): FriendsState => ({
    ...s, loadingRequests: false
  })),
);

// src/app/store/reducers/reducers.interactions/friends.reduce.ts
import { createReducer, on } from '@ngrx/store';
import * as A from '../../actions/actions.interactions/actions.friends';
import { FriendsState, initialState } from '../../states/states.interactions/friends.state';
import { BlockedUser } from '../../../core/interfaces/friendship/blocked-user.interface';

// Reducer
export const friendsReducer = createReducer(
  initialState,

  // Friends
  on(A.loadFriends, (s): FriendsState => ({ ...s, loading: true, error: null })),
  on(A.loadFriendsSuccess, (s, { friends }): FriendsState => ({ ...s, loading: false, friends })),
  on(A.loadFriendsFailure, (s, { error }): FriendsState => ({ ...s, loading: false, error })),

  // Send friend request
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

  // Inbound requests
  on(A.loadInboundRequests, (s): FriendsState => ({ ...s, loadingRequests: true, error: null })),
  on(A.loadInboundRequestsSuccess, (s, { requests }): FriendsState => ({
    ...s, loadingRequests: false, requests
  })),
  on(A.loadInboundRequestsFailure, (s, { error }): FriendsState => ({
    ...s, loadingRequests: false, error
  })),

  // Block list
  on(A.loadBlockedUsersSuccess, (s, { blocked }): FriendsState => ({ ...s, blocked })),

  // Otimistas simples (opcional)
  on(A.blockUser, (s, { targetUid, reason }): FriendsState => {
    const exists = s.blocked.some(b => b.uid === targetUid);
    if (exists) return s;
    const entry: BlockedUser = { uid: targetUid, reason, blockedAt: null };
    return { ...s, blocked: [...s.blocked, entry] };
  }),
  on(A.unblockUser, (s, { targetUid }): FriendsState => ({
    ...s, blocked: s.blocked.filter(b => b.uid !== targetUid)
  })),

  // Search (mantém compatibilidade com a tela)
  on(A.loadSearchResultsSuccess, (s, { results }): FriendsState => ({ ...s, searchResults: results })),
  on(A.loadSearchResultsFailure, (s, { error }): FriendsState => ({ ...s, error })),

  // Settings
  on(A.updateFriendSettings, (s, { settings }): FriendsState => ({ ...s, settings })),
);

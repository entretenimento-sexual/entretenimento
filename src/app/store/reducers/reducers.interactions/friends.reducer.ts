// src/app/store/reducers/reducers.interactions/friends.reduce.ts
import { createReducer, on } from '@ngrx/store';
import * as A from '../../actions/actions.interactions/actions.friends';
import * as RT from '../../actions/actions.interactions/friends/friends-realtime.actions';
import { FriendsState, initialState } from '../../states/states.interactions/friends.state';
import { BlockedUserActive } from 'src/app/core/interfaces/friendship/blocked-user.interface';
import { authSessionChanged, logoutSuccess } from '../../actions/actions.user/auth.actions';

export const friendsReducer = createReducer(
  initialState,

  /* 👥 Friends */
  on(A.loadFriends, (s): FriendsState => ({ ...s, loading: true, error: null })),
  on(A.loadFriendsSuccess, (s, { friends }): FriendsState => ({ ...s, loading: false, friends })),
  on(A.loadFriendsFailure, (s, { error }): FriendsState => ({ ...s, loading: false, error })),
on(A.endFriendship, (s, { friendUid }): FriendsState => ({
  ...s,
  endingFriendshipUid: String(friendUid ?? '').trim() || null,
  endingFriendshipError: null,
})),

on(A.endFriendshipSuccess, (s, { friendUid }): FriendsState => {
  const safeFriendUid = String(friendUid ?? '').trim();

  return {
    ...s,
    endingFriendshipUid: null,
    endingFriendshipError: null,
    friends: s.friends.filter(friend =>
      String(friend.friendUid ?? '').trim() !== safeFriendUid
    ),
  };
}),

on(A.endFriendshipFailure, (s, { error }): FriendsState => ({
  ...s,
  endingFriendshipUid: null,
  endingFriendshipError: error,
  error,
})),

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
  on(A.blockUserSuccess, (s, { ownerUid, targetUid }): FriendsState => {
    const exists = s.blocked.some(b => b.uid === targetUid);
    if (exists) return { ...s, blockError: null };
    const entry: BlockedUserActive = {
     uid: targetUid,
          isBlocked: true,
            reason: undefined,
              blockedAt: null,       // na UI podemos exibir “agora”; no backend virá timestamp real
                unblockedAt: null,
                  actorUid: ownerUid ?? '',   // quem executou a ação (o próprio usuário)
                    updatedAt: null
                    };
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
  on(RT.startInboundRequestsListener, (s): FriendsState => ({
    ...s, loadingRequests: true, error: null
  })),
  on(RT.inboundRequestsChanged, (s, { requests }): FriendsState => ({
    ...s, loadingRequests: false, requests
  })),
  on(RT.stopInboundRequestsListener, (s): FriendsState => ({
    ...s, loadingRequests: false
  })),
   on(RT.startOutboundRequestsListener, (s) => ({
   ...s, loadingOutboundRequests: true, error: null
   })),
 on(RT.outboundRequestsChanged, (s, { requests }) => ({
   ...s, loadingOutboundRequests: false, outboundRequests: requests
 })),
 on(RT.stopOutboundRequestsListener, (s) => ({
   ...s, loadingOutboundRequests: false
 })),

 on(RT.startFriendsListener, (s): FriendsState => ({
  ...s,
  loading: true,
  error: null,
})),

on(RT.friendsChanged, (s, { friends }): FriendsState => ({
  ...s,
  loading: false,
  friends,
})),

on(RT.stopFriendsListener, (s): FriendsState => ({
  ...s,
  loading: false,
})),

  on(logoutSuccess, () => initialState),

  // opcional: se a sessão virar nula por qualquer motivo
  on(authSessionChanged, (s, { uid }) => (uid ? s : initialState)),
);



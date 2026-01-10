// src/app/store/states/states.interactions/friends.state.ts
import { Timestamp } from 'firebase/firestore';
import { BlockedUserActive } from 'src/app/core/interfaces/friendship/blocked-user.interface';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';
import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export interface FriendsState {
  friends: Friend[];
  requests: (FriendRequest & { id: string })[];// 📥 Recebidas (inbound)
  requestersMap: Record<string, { uid: string; nickname?: string; avatarUrl?: string }>;
  outboundRequests: (FriendRequest & { id: string })[];// 📤 Enviadas (outbound)
  blocked: BlockedUserActive[];
  searchResults: IUserDados[];
  settings: {
    receiveRequests: boolean;
    showOnlineStatus: boolean;
    allowSearchByNickname: boolean;
  };
  // loading gerais
  loading: boolean;                // amigos
  loadingRequests: boolean;        // inbound
  loadingOutboundRequests: boolean;// outbound

  error: string | null;

  // status de envio (sendFriendRequest)
  sendingFriendRequest: boolean;
  sendFriendRequestError: string | null;
  sendFriendRequestSuccess: boolean;

  loadingBlocked: boolean;
  blockError: string | null;
}

export const initialState: FriendsState = {
  friends: [],

  requests: [],
  requestersMap: {},
  outboundRequests: [],

  blocked: [],
  searchResults: [],

  settings: {
    receiveRequests: true,
    showOnlineStatus: true,
    allowSearchByNickname: true,
  },

  loading: false,
  loadingRequests: false,
  loadingOutboundRequests: false,

  error: null,

  sendingFriendRequest: false,
  sendFriendRequestError: null,
  sendFriendRequestSuccess: false,

  loadingBlocked: false,
  blockError: null,
};

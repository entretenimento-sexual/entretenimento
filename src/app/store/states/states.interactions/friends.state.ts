// src\app\store\states\states.interactions\friends.state.ts
import { BlockedUser } from 'src/app/core/interfaces/friendship/blocked-user.interface';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';
import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';


export interface FriendsState {
  friends: Friend[];
  requests: (FriendRequest & { id: string })[]; 
  blocked: BlockedUser[];
  searchResults: IUserDados[];
    settings: {
      receiveRequests: boolean;
      showOnlineStatus: boolean;
      allowSearchByNickname: boolean;
    };
  loading: boolean;
  loadingRequests: boolean;
  error: string | null;

  // ⬇⬇⬇ NOVOS CAMPOS
  sendingFriendRequest: boolean;
  sendFriendRequestError: string | null;
  sendFriendRequestSuccess: boolean;
}

export const initialState: FriendsState = {
  friends: [],
  requests: [],
  blocked: [],
  searchResults: [],
  settings: { receiveRequests: true, showOnlineStatus: true, allowSearchByNickname: true },
  loading: false,
  loadingRequests: false,
  error: null,

  // ⬇⬇⬇ INICIALIZA
  sendingFriendRequest: false,
  sendFriendRequestError: null,
  sendFriendRequestSuccess: false,
};

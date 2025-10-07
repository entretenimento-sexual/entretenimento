// src\app\store\states\states.interactions\friends.state.ts
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IBlockedUser, IFriend } from 'src/app/core/interfaces/friendship/ifriend';
import { IFriendRequest } from 'src/app/core/interfaces/friendship/ifriend-request';

export interface FriendsState {
  friends: IFriend[];
  requests: IFriendRequest[];
  blocked: IBlockedUser[];
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

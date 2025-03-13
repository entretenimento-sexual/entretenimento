// src\app\store\states\states.interactions\friends.state.ts
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { createReducer, on } from '@ngrx/store';
import * as FriendsActions from '../../actions/actions.interactions/actions.friends';
import { IBlockedUser, IFriend } from 'src/app/core/interfaces/friendship/ifriend';
import { IFriendRequest } from 'src/app/core/interfaces/friendship/ifriend-request';

export interface FriendsState {
  friends: IFriend[];             // ✅ Lista de amigos corrigida
  requests: IFriendRequest[];     // ✅ Lista de solicitações de amizade
  blocked: IBlockedUser[];        // ✅ Lista de usuários bloqueados
  searchResults: IUserDados[];    // 🔹 A busca pode retornar perfis completos
  settings: {
    receiveRequests: boolean;
    showOnlineStatus: boolean;
    allowSearchByNickname: boolean;
  };
  loading: boolean;
  loadingRequests: boolean;
  error: string | null;
}

export const initialState: FriendsState = {
  friends: [],       // ✅ Agora inicia corretamente como IFriend[]
  requests: [],      // ✅ Agora inicia corretamente como IFriendRequest[]
  blocked: [],       // ✅ Agora inicia corretamente como IBlockedUser[]
  searchResults: [], // 🔹 Mantido como IUserDados[], pois é usado na busca
  settings: { receiveRequests: true, showOnlineStatus: true, allowSearchByNickname: true },
  loading: false,
  loadingRequests: false,
  error: null
};

export const friendsReducer = createReducer(
  initialState,
  on(FriendsActions.loadFriends, state => ({ ...state, loading: true })),
  on(FriendsActions.loadFriendsSuccess, (state, { friends }) => ({
    ...state,
    friends: friends.map(friend => ({
      friendUid: friend.friendUid,
      friendSince: new Date(friend.friendSince)  
    })),
    loading: false,
    error: null
  })),
  on(FriendsActions.loadFriendsFailure, (state, { error }) => ({
    ...state, loading: false, error
  })),
  on(FriendsActions.loadRequestsSuccess, (state, { requests }) => ({
    ...state,
    requests: requests.map(req => ({
      requesterUid: req.requesterUid, // ✅ Correção: garantindo o tipo correto
      recipientUid: req.recipientUid,
      type: req.type,
      message: req.message,
      timestamp: new Date(req.timestamp),
      expiresAt: new Date(req.expiresAt)
    })),
    loadingRequests: false
  })),
  on(FriendsActions.loadRequests, (state) => ({
    ...state, loadingRequests: true
  })),
  on(FriendsActions.loadBlockedSuccess, (state, { blocked }) => ({
    ...state,
    blocked: blocked.map(block => ({
      blockerUid: block.blockerUid, // ✅ Correção: garantindo o tipo correto
      blockedUid: block.blockedUid,
      timestamp: new Date(block.timestamp)
    }))
  })),
  on(FriendsActions.loadSearchResultsSuccess, (state, { results }) => ({
    ...state, searchResults: results
  })),
  on(FriendsActions.updateFriendSettings, (state, { settings }) => ({
    ...state, settings
  }))
);

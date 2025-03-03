// src\app\store\states\states.interactions\friends.state.ts
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { createReducer, on } from '@ngrx/store';
import * as FriendsActions from '../../actions/actions.interactions/actions.friends';

export interface FriendsState {
  friends: IUserDados[];
  requests: IUserDados[];
  blocked: IUserDados[];
  searchResults: IUserDados[];
  settings: {
    receiveRequests: boolean;
    showOnlineStatus: boolean;
    allowSearchByNickname: boolean;
  };
  loading: boolean;
  error: string | null;
}

export const initialState: FriendsState = {
  friends: [],
  requests: [],
  blocked: [],
  searchResults: [],
  settings: { receiveRequests: true, showOnlineStatus: true, allowSearchByNickname: true },
  loading: false,
  error: null
};

export const friendsReducer = createReducer(
  initialState,
  on(FriendsActions.loadFriends, state => ({ ...state, loading: true })),
  on(FriendsActions.loadFriendsSuccess, (state, { friends }) => ({
    ...state, friends, loading: false, error: null
  })),
  on(FriendsActions.loadFriendsFailure, (state, { error }) => ({
    ...state, loading: false, error
  })),
  on(FriendsActions.loadRequestsSuccess, (state, { requests }) => ({
    ...state, requests
  })),
  on(FriendsActions.loadBlockedSuccess, (state, { blocked }) => ({
    ...state, blocked
  })),
   on(FriendsActions.loadSearchResultsSuccess, (state, { results }) => ({
     ...state, searchResults: results // 🔹 Agora armazenamos os resultados da busca no Store
   })),
  on(FriendsActions.updateFriendSettings, (state, { settings }) => ({
    ...state, settings
  }))
);

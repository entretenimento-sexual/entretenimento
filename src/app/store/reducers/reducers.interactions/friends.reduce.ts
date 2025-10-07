// src/app/store/reducers/reducers.interactions/friends.reduce.ts
import { createReducer, on } from '@ngrx/store';
import * as FriendsActions from '../../actions/actions.interactions/actions.friends';
import { FriendsState } from '../../states/states.interactions/friends.state';
import { IBlockedUser } from 'src/app/core/interfaces/friendship/ifriend';

/** 🔹 Estado inicial do reducer (deve espelhar o initialState do FriendsState) */
export const initialState: FriendsState = {
  friends: [],
  requests: [],
  blocked: [],
  searchResults: [],
  settings: { receiveRequests: true, showOnlineStatus: true, allowSearchByNickname: true },
  loading: false,
  loadingRequests: false,
  error: null,

  // ⬇ Flags de envio de solicitação
  sendingFriendRequest: false,
  sendFriendRequestError: null,
  sendFriendRequestSuccess: false,
};

/** 🔥 Reducer principal para interações de amizade */
export const friendsReducer = createReducer(
  initialState as FriendsState,

  /** 🔄 Iniciar carregamento dos amigos */
  on(FriendsActions.loadFriends, (state): FriendsState => ({
    ...state,
    loading: true,
    // opcional: zera erros anteriores do domínio
    // error: null,
  })),

  /** ✅ Carregar amigos com sucesso */
  on(FriendsActions.loadFriendsSuccess, (state, { friends }): FriendsState => ({
    ...state,
    friends: Array.isArray(friends) ? friends : [],
    loading: false,
    error: null,
  })),

  /** ❌ Falha ao carregar amigos */
  on(FriendsActions.loadFriendsFailure, (state, { error }): FriendsState => ({
    ...state,
    loading: false,
    error,
  })),

  /** 🔄 Iniciar carregamento das solicitações de amizade */
  on(FriendsActions.loadRequests, (state): FriendsState => ({
    ...state,
    loadingRequests: true,
  })),

  /** ✅ Carregar solicitações de amizade com sucesso */
  on(FriendsActions.loadRequestsSuccess, (state, { requests }): FriendsState => ({
    ...state,
    requests: Array.isArray(requests) ? requests : [],
    loadingRequests: false,
  })),

  /** ❌ Falha ao carregar solicitações de amizade */
  on(FriendsActions.loadRequestsFailure, (state, { error }): FriendsState => ({
    ...state,
    loadingRequests: false,
    error,
  })),

  /** ✅ Carregar lista de usuários bloqueados */
  on(FriendsActions.loadBlockedSuccess, (state, { blocked }): FriendsState => ({
    ...state,
    blocked: Array.isArray(blocked) ? blocked : [],
  })),

  /**
   * ➕ Fluxo de envio de solicitação de amizade
   * - Não altera a lista de friends aqui (somente quando houver aceite).
   */
  on(FriendsActions.sendFriendRequest, (state): FriendsState => ({
    ...state,
    sendingFriendRequest: true,
    sendFriendRequestError: null,
    sendFriendRequestSuccess: false,
  })),

  on(FriendsActions.sendFriendRequestSuccess, (state): FriendsState => ({
    ...state,
    sendingFriendRequest: false,
    sendFriendRequestSuccess: true,
  })),

  on(FriendsActions.sendFriendRequestFailure, (state, { error }): FriendsState => ({
    ...state,
    sendingFriendRequest: false,
    sendFriendRequestError: error,
  })),

  on(FriendsActions.resetSendFriendRequestStatus, (state): FriendsState => ({
    ...state,
    sendFriendRequestSuccess: false,
    sendFriendRequestError: null,
  })),

  /** 🚫 Bloquear um amigo */
  on(FriendsActions.blockFriendSuccess, (state, { uid }): FriendsState => {
    const friendToBlock = state.friends.find(f => f.friendUid === uid);
    if (!friendToBlock) {
      return { ...state }; // evita estado inválido quando não encontrado
    }

    const alreadyBlocked = state.blocked.some(b => b.blockedUid === uid);

    return {
      ...state,
      friends: state.friends.filter(f => f.friendUid !== uid),
      blocked: alreadyBlocked
        ? state.blocked
        : [
          ...state.blocked,
          { blockerUid: uid, blockedUid: friendToBlock.friendUid, timestamp: new Date() } as IBlockedUser,
        ],
    };
  }),

  /** ✅ Desbloquear um amigo */
  on(FriendsActions.unblockFriendSuccess, (state, { uid }): FriendsState => ({
    ...state,
    blocked: state.blocked.filter((user: IBlockedUser) => user.blockedUid !== uid),
  })),

  /** 🔍 Atualizar resultados de pesquisa de amigos */
  on(FriendsActions.loadSearchResultsSuccess, (state, { results }): FriendsState => ({
    ...state,
    searchResults: Array.isArray(results) ? results : [],
  })),

  /** ❌ Falha na busca de amigos */
  on(FriendsActions.loadSearchResultsFailure, (state, { error }): FriendsState => ({
    ...state,
    error,
  })),

  /** ⚙ Atualiza as configurações de amizade */
  on(FriendsActions.updateFriendSettings, (state, { settings }): FriendsState => ({
    ...state,
    settings,
  }))
);

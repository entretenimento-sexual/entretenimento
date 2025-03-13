// src\app\store\reducers\reducers.interactions\friends.reduce.ts
import { createReducer, on } from '@ngrx/store';
import * as FriendsActions from '../../actions/actions.interactions/actions.friends';
import { FriendsState } from '../../states/states.interactions/friends.state';
import { IBlockedUser, IFriend } from 'src/app/core/interfaces/friendship/ifriend';

/** 🔹 Estado inicial do reducer */
export const initialState: FriendsState = {
  friends: [],
  requests: [],
  blocked: [],
  searchResults: [], // 🔹 Garante que o estado de busca comece corretamente
  settings: { receiveRequests: true, showOnlineStatus: true, allowSearchByNickname: true },
  loading: false,
  loadingRequests: false,
  error: null
};

/** 🔥 Reducer principal para interações de amizade */
export const friendsReducer = createReducer(
  initialState as FriendsState, // ✅ Define explicitamente o tipo para evitar erros

  /** 🔄 Iniciar carregamento dos amigos */
  on(FriendsActions.loadFriends, (state): FriendsState => ({
    ...state, loading: true
  })),

  /** ✅ Carregar amigos com sucesso */
  on(FriendsActions.loadFriendsSuccess, (state, { friends }): FriendsState => ({
    ...state,
    friends: Array.isArray(friends) ? friends : [], // 🔥 Garante que friends sempre seja um array válido
    loading: false,
    error: null
  })),

  /** ❌ Falha ao carregar amigos */
  on(FriendsActions.loadFriendsFailure, (state, { error }): FriendsState => ({
    ...state, loading: false, error
  })),

  /** 🔄 Iniciar carregamento das solicitações de amizade */
  on(FriendsActions.loadRequests, (state): FriendsState => ({
    ...state, loadingRequests: true
  })),

  /** ✅ Carregar solicitações de amizade com sucesso */
  on(FriendsActions.loadRequestsSuccess, (state, { requests }): FriendsState => ({
    ...state,
    requests: Array.isArray(requests) ? requests : [], // 🔥 Garante que requests seja sempre um array válido
    loadingRequests: false
  })),

  /** ❌ Falha ao carregar solicitações de amizade */
  on(FriendsActions.loadRequestsFailure, (state, { error }): FriendsState => ({
    ...state, loadingRequests: false, error
  })),

  /** ✅ Carregar lista de usuários bloqueados */
  on(FriendsActions.loadBlockedSuccess, (state, { blocked }): FriendsState => ({
    ...state,
    blocked: Array.isArray(blocked) ? blocked : [] // 🔥 Garante que blocked seja sempre um array válido
  })),

  /** ➕ Enviar solicitação de amizade com sucesso */
  on(FriendsActions.sendFriendRequestSuccess, (state, { friend }): FriendsState => {
    // 🔹 Evita adicionar duplicatas na lista de amigos
    const alreadyExists = state.friends.some(f => f.friendUid === friend.friendUid);

    return {
      ...state,
      friends: alreadyExists ? state.friends : [...state.friends, friend]
    };
  }),

  /** ❌ Falha ao enviar solicitação de amizade */
  on(FriendsActions.sendFriendRequestFailure, (state, { error }): FriendsState => ({
    ...state, error
  })),

  /** 🚫 Bloquear um amigo */
  on(FriendsActions.blockFriendSuccess, (state, { uid }): FriendsState => {
    const friendToBlock = state.friends.find(friend => friend.friendUid === uid);

    if (!friendToBlock) {
      return { ...state }; // ✅ Se o amigo não existir, evita estado inválido
    }

    // 🔹 Verifica se o usuário já está bloqueado
    const alreadyBlocked = state.blocked.some(blocked => blocked.blockedUid === uid);

    return {
      ...state,
      friends: state.friends.filter(friend => friend.friendUid !== uid),
      blocked: alreadyBlocked
        ? state.blocked
        : [...state.blocked, { blockerUid: uid, blockedUid: friendToBlock.friendUid, timestamp: new Date() }]
    };
  }),

  /** ✅ Desbloquear um amigo */
  on(FriendsActions.unblockFriendSuccess, (state, { uid }): FriendsState => ({
    ...state,
    blocked: state.blocked.filter((user: IBlockedUser) => user.blockedUid !== uid) // 🔥 Remove o usuário da lista de bloqueados
  })),

  /** 🔍 Atualizar resultados de pesquisa de amigos */
  on(FriendsActions.loadSearchResultsSuccess, (state, { results }): FriendsState => ({
    ...state, searchResults: Array.isArray(results) ? results : [] // 🔥 Garante que results seja um array válido
  })),

  /** ❌ Falha na busca de amigos */
  on(FriendsActions.loadSearchResultsFailure, (state, { error }): FriendsState => ({
    ...state, error
  })),

  /** ⚙ Atualiza as configurações de amizade */
  on(FriendsActions.updateFriendSettings, (state, { settings }): FriendsState => ({
    ...state, settings
  }))
);

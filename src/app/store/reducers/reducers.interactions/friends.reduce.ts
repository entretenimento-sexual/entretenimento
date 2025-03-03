//src\app\store\reducers\reducers.interactions\friends.reduce.ts
import { createReducer, on } from '@ngrx/store';
import * as FriendsActions from '../../actions/actions.interactions/actions.friends';
import { FriendsState } from '../../states/states.interactions/friends.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export const friendsReducer = createReducer(
  {
    friends: [],
    requests: [],
    blocked: [],
    loading: false,
    error: null
  } as FriendsState,

  // 🔄 Iniciar carregamento dos amigos
  on(FriendsActions.loadFriends, state => ({
    ...state, loading: true
  })),

  // ✅ Sucesso ao carregar amigos
  on(FriendsActions.loadFriendsSuccess, (state, { friends }) => ({
    ...state, friends, loading: false, error: null
  })),

  // ❌ Falha ao carregar amigos
  on(FriendsActions.loadFriendsFailure, (state, { error }) => ({
    ...state, loading: false, error
  })),

  // 📩 Carregar pedidos de amizade
  on(FriendsActions.loadRequestsSuccess, (state, { requests }) => ({
    ...state, requests
  })),

  // 🚫 Carregar lista de bloqueados
  on(FriendsActions.loadBlockedSuccess, (state, { blocked }) => ({
    ...state, blocked
  })),

  // ➕ Adicionar um amigo à lista
  on(FriendsActions.addFriendSuccess, (state, { friend }) => ({
    ...state, friends: [...state.friends, friend]
  })),

  // 🚫 Bloquear um amigo - corrigindo a estrutura para garantir que `uid` nunca seja `undefined`
  on(FriendsActions.blockFriendSuccess, (state, { uid }) => {
    const friendToBlock = state.friends.find(friend => friend.uid === uid);

    // Evita adicionar valores indefinidos ao array de bloqueados
    if (!friendToBlock) {
      return state;
    }

    return {
      ...state,
      friends: state.friends.filter(friend => friend.uid !== uid),
      blocked: [...state.blocked, { ...friendToBlock }]
    };
  })
);

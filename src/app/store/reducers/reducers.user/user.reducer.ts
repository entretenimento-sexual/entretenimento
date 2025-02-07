// src/app/store/reducers/user.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  updateUserOnlineStatus,
  loadOnlineUsersSuccess,
  setFilteredOnlineUsers,
  setCurrentUser,
  clearCurrentUser,
  addUserToState,
} from '../../actions/actions.user/user.actions';
import { logoutSuccess } from '../../actions/actions.user/auth.actions';
import { initialUserState } from '../../states/states.user/user.state';

// Redutor para o estado de usuários.
export const userReducer = createReducer(
  initialUserState,

  // Ação: Adiciona um usuário específico ao estado, se ele ainda não estiver presente.
  on(addUserToState, (state, { user }) => {
    if (!user.uid) {
      console.log('Usuário sem UID foi fornecido à ação addUserToState.');
      return state;
    }

    console.log('Ação addUserToState recebida para UID:', user.uid);

    // Adiciona ou atualiza o usuário no estado
    return {
      ...state,
      users: {
        ...state.users,
        [user.uid]: {
          ...state.users[user.uid],  // Mantém qualquer informação anterior do usuário no estado
          ...user                    // Sobrescreve com os novos dados recebidos
        }
      }
    };
  }),

  // Ação: Indica que o processo de carregamento de todos os usuários começou.
  on(loadUsers, (state) => {
    console.log('Ação disparada: Carregar Usuários');
    return { ...state, loading: true };
  }),

  // Ação: Atualiza o estado com a lista de usuários carregados.
  on(loadUsersSuccess, (state, { users }) => {
    const updatedUsers = {
      ...state.users,
      ...users.reduce((acc, user) => {
        acc[user.uid] = user;
        return acc;
      }, {} as { [uid: string]: IUserDados }),
    };
    console.log(
      `Usuários carregados com sucesso. Total de usuários no estado: ${Object.keys(updatedUsers).length}`
    );
    return {
      ...state,
      users: updatedUsers,
      loading: false,
      error: null,
    };
  }),

  // Ação: Define o erro no estado em caso de falha ao carregar usuários.
  on(loadUsersFailure, (state, { error }) => {
    console.error('Erro ao carregar usuários:', error);
    return { ...state, loading: false, error };
  }),

  // Ação: Atualiza o estado de usuários online com os dados recebidos.
  on(loadOnlineUsersSuccess, (state, { users }) => {
    console.log(`Usuários online carregados com sucesso. Total: ${users.length}`);
    return {
      ...state,
      onlineUsers: users,
      error: null,
    };
  }),

  // Ação: Atualiza o status online de um usuário específico.
  on(updateUserOnlineStatus, (state, { uid, isOnline }) => {
    if (!(uid in state.users)) {
      console.log(`Usuário com UID ${uid} não encontrado no estado.`);
      return state;
    }
    const updatedUser = { ...state.users[uid], isOnline };
    return {
      ...state,
      users: { ...state.users, [uid]: updatedUser },
    };
  }),

  // Ação: Atualiza a lista de usuários online filtrados no estado.
  on(setFilteredOnlineUsers, (state, { filteredUsers }) => {
    console.log('Usuários online filtrados definidos:', filteredUsers.length);
    return { ...state, filteredUsers };
  }),

  // Ação: Define o usuário atual no estado.
  on(setCurrentUser, (state, { user }) => {
    console.log('Usuário atual definido:', user);
    return { ...state, currentUser: user };
  }),

  // Ação: Remove o usuário atual do estado.
  on(clearCurrentUser, logoutSuccess, (state) => {
    console.log('[User Reducer] Usuário removido do estado após logout.');
    return { ...state, currentUser: null };
  })
);

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
import { initialUserState } from '../../states/states.user/user.state';

/**
 * Função auxiliar para adicionar usuários sem duplicação ao estado.
 * @param existingUsers - Lista de usuários já presentes no estado.
 * @param newUsers - Lista de novos usuários a serem adicionados.
 * @returns Lista de usuários combinada sem duplicados.
 */
function addUniqueUsers(existingUsers: IUserDados[], newUsers: IUserDados[]): IUserDados[] {
  return [
    ...existingUsers,
    ...newUsers.filter(
      (newUser) => !existingUsers.some((existingUser) => existingUser.uid === newUser.uid)
    ),
  ];
}

//Redutor para o estado de usuários.
export const userReducer = createReducer(
  initialUserState, // Estado inicial definido no arquivo de estado.
  
  //Ação: Adiciona um usuário específico ao estado, se ele ainda não estiver presente.
  on(addUserToState, (state, { user }) => {
    if (state.users.some((existingUser) => existingUser.uid === user.uid)) {
      console.log(`Usuário ${user.uid} já está no estado.`);
      return state; // Retorna o estado sem alterações se o usuário já existir.
    }
    console.log('Ação disparada: Adicionar Usuário ao Estado', user);
    return {
      ...state,
      users: [...state.users, user],
    };
  }),

  //Ação: Indica que o processo de carregamento de todos os usuários começou.
  on(loadUsers, (state) => {
    console.log('Ação disparada: Carregar Usuários');
    return { ...state, loading: true };
  }),

  //Ação: Atualiza o estado com a lista de usuários carregados.
  on(loadUsersSuccess, (state, { users }) => {
    const updatedUsers = addUniqueUsers(state.users, users);
    console.log(
      `Usuários carregados com sucesso. Total de usuários no estado: ${updatedUsers.length}`
    );
    return {
      ...state,
      users: updatedUsers,
      loading: false,
      error: null,
    };
  }),

  //Ação: Define o erro no estado em caso de falha ao carregar usuários.
  on(loadUsersFailure, (state, { error }) => {
    console.error('Erro ao carregar usuários:', error);
    return { ...state, loading: false, error };
  }),

  //Ação: Atualiza o estado de usuários online com os dados recebidos.
  on(loadOnlineUsersSuccess, (state, { users }) => {
    console.log(`Usuários online carregados com sucesso. Total: ${users.length}`);
    return {
      ...state,
      onlineUsers: users, // Atualiza a lista de usuários online no estado.
      error: null,
    };
  }),

 // Ação: Atualiza o estado de carregamento e o erro ao falhar no carregamento de usuários online.
  on(loadUsersFailure, (state, { error }) => {
    console.error('Erro ao carregar usuários online:', error);
    return { ...state, loading: false, error };
  }),

  //Ação: Atualiza o status online de um usuário específico.
  on(updateUserOnlineStatus, (state, { uid, isOnline }) => {
    const updatedUsers = state.users.map((user) =>
      user.uid === uid ? { ...user, isOnline } : user
    );
    console.log(`Atualizando status online do usuário ${uid}: ${isOnline}`);
    return { ...state, users: updatedUsers };
  }),

  //Ação: Atualiza a lista de usuários online filtrados no estado.
  on(setFilteredOnlineUsers, (state, { filteredUsers }) => {
    console.log('Usuários online filtrados definidos:', filteredUsers.length);
    return { ...state, filteredUsers };
  }),

  //Ação: Define o usuário atual no estado.
  on(setCurrentUser, (state, { user }) => {
    console.log('Usuário atual definido:', user);
    return { ...state, currentUser: user };
  }),

  //Ação: Remove o usuário atual do estado.
  on(clearCurrentUser, (state) => {
    console.log('Usuário atual removido do estado.');
    return { ...state, currentUser: null };
  })
);

// src/app/store/reducers/user.reducer.ts
import { createReducer, on } from '@ngrx/store';
import {
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  setCurrentUser,
  clearCurrentUser,
  loadOnlineUsersSuccess,
  setFilteredOnlineUsers
} from '../actions/user.actions';
import { loginSuccess } from '../actions/auth.actions';
import { updateUserOnlineStatus } from '../actions/user-status.actions';
import { initialUserState } from '../states/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';


export const userReducer = createReducer(
  // Estado inicial do reducer
  initialUserState,

  /**
   * Ação disparada quando começa o carregamento de todos os usuários.
   * Atualiza o estado para indicar que o carregamento está em progresso.
   */
  on(loadUsers, state => {
    console.log('Carregando usuários...');
    return { ...state, loading: true };
  }),

  /**
   * Ação disparada quando os usuários são carregados com sucesso.
   * Atualiza o estado com os usuários carregados e marca o carregamento como concluído.
   */
  on(loadUsersSuccess, (state, { users }) => {
    console.log('Usuários carregados com sucesso e armazenados no estado:', users);

    // Atualiza a lista de usuários, mantendo os usuários já existentes no estado e combinando com os novos
    const updatedUsers = [...state.users, ...users.filter(user => !state.users.some(existingUser => existingUser.uid === user.uid))];

    return {
      ...state,
      users,  // Atualiza a lista de usuários no estado
      loading: false,
      error: null,
    };
  }),

  /**
   * Ação disparada quando ocorre um erro ao carregar os usuários.
   * Atualiza o estado para refletir que ocorreu um erro durante o carregamento.
   */
  on(loadUsersFailure, (state, { error }) => {
    console.error('Erro ao carregar usuários:', error);
    return { ...state, loading: false, error };
  }),

  /**
   * Ação disparada para atualizar o status online de um usuário específico.
   * Atualiza o estado com o novo status do usuário.
   */
  on(updateUserOnlineStatus, (state, { uid, isOnline }) => {
    console.log(`Atualizando status online do usuário ${uid} para ${isOnline}`);
    const updatedUsers: IUserDados[] = state.users.map(user =>
      user.uid === uid ? { ...user, isOnline } : user
    );
    console.log('Estado atualizado dos usuários:', updatedUsers);
    return {
      ...state,
      users: updatedUsers,
    };
  }),

  /**
   * Ação disparada quando os usuários online são carregados com sucesso.
   * Atualiza o estado com os usuários online.
   */
  on(loadOnlineUsersSuccess, (state, { users }) => {
    console.log('Usuários recebidos no reducer:', users);
    return {
      ...state,
      users
    };
  }),

  /**
   * Ação disparada para definir os usuários online filtrados por algum critério,
   * como município ou outra condição.
   */
  on(setFilteredOnlineUsers, (state, { filteredUsers }) => {
    console.log('Usuários filtrados por município ou outro critério:', filteredUsers);
    return {
      ...state,
      filteredUsers,  // Atualiza a lista de usuários filtrados no estado
    };
  }),

  /**
   * Ação disparada para definir o usuário atual no estado.
   * Atualiza o estado com o usuário logado.
   */
  on(setCurrentUser, (state, { user }) => {
    console.log('Ação setCurrentUser disparada. Usuário atual:', user);
    return {
      ...state,
      currentUser: user,  // Armazena o usuário atual no estado
    };
  }),

  /**
   * Ação disparada para limpar o usuário atual.
   * Usada quando o usuário se desloga ou os dados precisam ser redefinidos.
   */
  on(clearCurrentUser, (state) => {
    console.log('Ação clearCurrentUser disparada. Limpando usuário atual.');
    return {
      ...state,
      currentUser: null,  // Remove o usuário atual do estado
    };
  })
);

/**
 * Explicação das partes:
 *
 * - `loadUsers`, `loadUsersSuccess`, `loadUsersFailure`: Usados para o fluxo de carregamento de todos os usuários.
 *   Mantido para carregar todos os usuários em algum momento do aplicativo.
 *
 * - `updateUserOnlineStatus`: Gerencia o status online dos usuários no estado global.
 *   Mantido para atualizar o status dos usuários no estado da aplicação.
 *
 * - `loadOnlineUsersSuccess`: Carregamento focado apenas nos usuários online.
 *   Mantido para exibir apenas os usuários online.
 *
 * - `setFilteredOnlineUsers`: Armazena uma lista filtrada de usuários no estado, útil para filtrar por município ou outros critérios.
 *   Mantido para aplicar filtros específicos aos usuários online.
 *
 * - `setCurrentUser`: Armazena o usuário atualmente logado no estado, essencial para rastrear o usuário autenticado.
 *   Mantido para definir o estado do usuário autenticado.
 *
 * - `clearCurrentUser`: Limpa os dados do usuário atual do estado, útil quando o usuário se desloga.
 *   Mantido para redefinir o estado quando necessário.
 *
 * Após revisar, você pode decidir o que manter ou ajustar com base no fluxo da sua aplicação.
 */


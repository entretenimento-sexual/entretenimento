// src/app/store/reducers/user.reducer.ts
import { createReducer, on } from '@ngrx/store';
import {
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  updateUserOnlineStatus,
  loadOnlineUsersSuccess,
  setFilteredOnlineUsers
} from '../actions/user.actions';
import { UserState, initialUserState } from '../states/user.state';
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
  on(setFilteredOnlineUsers, (state, { filteredUsers }) => ({
    ...state,
    filteredUsers,  // Atualiza a lista de usuários filtrados no estado
  }))
);

/**
 * Explicação das partes:
 *
 * - `loadUsers`, `loadUsersSuccess`, `loadUsersFailure`: Usados para o fluxo de carregamento de todos os usuários.
 *   Manter se você precisar carregar todos os usuários em algum momento.
 *
 * - `updateUserOnlineStatus`: Útil para gerenciar o status online dos usuários no estado global.
 *   Manter se for necessário atualizar o status dos usuários no estado da aplicação.
 *
 * - `loadOnlineUsersSuccess`: Focado no carregamento apenas de usuários online.
 *   Manter se o foco da aplicação for exibir apenas os usuários que estão online.
 *
 * - `setFilteredOnlineUsers`: Permite armazenar uma lista filtrada de usuários no estado, útil para filtrar por município ou outro critério.
 *   Manter se for necessário aplicar filtros específicos aos usuários online.
 *
 * Após revisar, você pode decidir o que manter ou remover com base no fluxo da sua aplicação.
 */


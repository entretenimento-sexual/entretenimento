// src/app/store/actions/user.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IError } from 'src/app/core/interfaces/ierror';

/**
 * Tipos de Ações de Usuário
 */
export const USER_ACTION_TYPES = {
  OBSERVE_USER_CHANGES: '[Usuário] Observar Mudanças no Usuário',
  SET_CURRENT_USER: '[Usuário] Definir Usuário Atual',
  CLEAR_CURRENT_USER: '[Usuário] Limpar Usuário Atual',
  LOAD_USERS: '[Usuário] Carregar Usuários',
  LOAD_USERS_SUCCESS: '[Usuário] Carregar Usuários com Sucesso',
  LOAD_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários',
  UPDATE_USER_ONLINE_STATUS: '[Usuário] Atualizar Status Online do Usuário',
  ADD_USER_TO_STATE: '[Usuário] Adicionar Usuário ao Estado',
  LOAD_ONLINE_USERS: '[Usuário] Carregar Usuários Online',
  LOAD_ONLINE_USERS_SUCCESS: '[Usuário] Carregar Usuários Online com Sucesso',
  LOAD_ONLINE_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários Online',
  SET_FILTERED_ONLINE_USERS: '[Usuário] Definir Usuários Online Filtrados',
  SET_FILTERED_USERS: '[Usuário] Definir Usuários Filtrados',
};

/**
 * Ações para gerenciar o estado do usuário
 */

// Ação para observar mudanças no usuário
export const observeUserChanges = createAction(
  USER_ACTION_TYPES.OBSERVE_USER_CHANGES,
  props<{ uid: string }>()
);

// Ação para definir o usuário atual
export const setCurrentUser = createAction(
  USER_ACTION_TYPES.SET_CURRENT_USER,
  props<{ user: IUserDados }>()
);

// Ação para limpar o usuário atual
export const clearCurrentUser = createAction(
  USER_ACTION_TYPES.CLEAR_CURRENT_USER
);

// Ações relacionadas ao carregamento de usuários
export const loadUsers = createAction(USER_ACTION_TYPES.LOAD_USERS);

export const loadUsersSuccess = createAction(
  USER_ACTION_TYPES.LOAD_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

export const loadUsersFailure = createAction(
  USER_ACTION_TYPES.LOAD_USERS_FAILURE,
  props<{ error: IError }>()
);

// Ação para atualizar o status online de um usuário
export const updateUserOnlineStatus = createAction(
  USER_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS,
  props<{ uid: string, isOnline: boolean }>()
);

// Ação para adicionar um usuário ao estado
export const addUserToState = createAction(
  USER_ACTION_TYPES.ADD_USER_TO_STATE,
  props<{ user: IUserDados }>()
);

// Ações relacionadas ao carregamento de usuários online
export const loadOnlineUsers = createAction(
  USER_ACTION_TYPES.LOAD_ONLINE_USERS
);

export const loadOnlineUsersSuccess = createAction(
  USER_ACTION_TYPES.LOAD_ONLINE_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

export const loadOnlineUsersFailure = createAction(
  USER_ACTION_TYPES.LOAD_ONLINE_USERS_FAILURE,
  props<{ error: IError }>()
);

// Ação para definir a lista de usuários online filtrados
export const setFilteredOnlineUsers = createAction(
  USER_ACTION_TYPES.SET_FILTERED_ONLINE_USERS,
  props<{ filteredUsers: IUserDados[] }>()
);

// Ação para definir a lista de usuários filtrados
export const setFilteredUsers = createAction(
  USER_ACTION_TYPES.SET_FILTERED_USERS,
  props<{ filteredUsers: IUserDados[] }>()
);

// src/app/store/actions/user-online.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IError } from 'src/app/core/interfaces/ierror';

/**
 * Ações Específicas de Usuários Online
 * Este arquivo foca na gestão da lista de usuários que estão online e atualizações em tempo real.
 */
export const USER_ONLINE_ACTION_TYPES = {
  SET_USER_ONLINE_STATUS: '[User Online] Definir Status Online do Usuário',
  UPDATE_USER_ONLINE_LIST: '[User Online] Atualizar Lista de Usuários Online',
  LOAD_ONLINE_USERS: '[User Online] Carregar Usuários Online',
  LOAD_ONLINE_USERS_SUCCESS: '[User Online] Carregar Usuários Online com Sucesso',
  LOAD_ONLINE_USERS_FAILURE: '[User Online] Falha ao Carregar Usuários Online',
};

/**
 * Ações para gerenciar a lista de usuários online
 */

// Ação para definir o status online de um usuário específico
export const setUserOnlineStatus = createAction(
  USER_ONLINE_ACTION_TYPES.SET_USER_ONLINE_STATUS,
  props<{ uid: string; isOnline: boolean }>()
);

// Ação para atualizar a lista de usuários online
export const updateOnlineUsers = createAction(
  USER_ONLINE_ACTION_TYPES.UPDATE_USER_ONLINE_LIST,
  props<{ onlineUsers: IUserDados[] }>()
);

// Ações para carregar usuários online
export const loadOnlineUsers = createAction(
  USER_ONLINE_ACTION_TYPES.LOAD_ONLINE_USERS
);

export const loadOnlineUsersSuccess = createAction(
  USER_ONLINE_ACTION_TYPES.LOAD_ONLINE_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

export const loadOnlineUsersFailure = createAction(
  USER_ONLINE_ACTION_TYPES.LOAD_ONLINE_USERS_FAILURE,
  props<{ error: IError }>()
);

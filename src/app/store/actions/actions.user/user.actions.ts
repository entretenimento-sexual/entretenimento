// src/app/store/actions/actions.user/user.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IError } from 'src/app/core/interfaces/ierror';

/**
 * IMPORTANTE (presença):
 * - PresenceService é o writer único de isOnline/lastSeen.
 * - NgRx NÃO deve simular online/offline.
 * - OnlineUsers deve vir de query Firestore (ex.: where('isOnline','==',true)).
 */

export const USER_ACTION_TYPES = {
  SET_CURRENT_USER: '[Usuário] Definir Usuário Atual',
  CLEAR_CURRENT_USER: '[Usuário] Limpar Usuário Atual',

  LOAD_USERS: '[Usuário] Carregar Usuários',
  LOAD_USERS_SUCCESS: '[Usuário] Carregar Usuários com Sucesso',
  LOAD_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários',

  LOAD_ONLINE_USERS: '[Usuário] Carregar Usuários Online',
  LOAD_ONLINE_USERS_SUCCESS: '[Usuário] Carregar Usuários Online com Sucesso',
  LOAD_ONLINE_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários Online',

  ADD_USER_TO_STATE: '[Usuário] Adicionar Usuário ao Estado',
  UPDATE_USER_IN_STATE: '[Usuário] Atualizar Usuário no Estado',

  SET_FILTERED_ONLINE_USERS: '[Usuário] Definir Usuários Online Filtrados',

  OBSERVE_USER_CHANGES: '[Usuário] Observar Mudanças no Usuário',

  /**
   * @deprecated
   * Não usar para presença oficial.
   * Mantido por compatibilidade com fluxos antigos.
   */
  UPDATE_USER_ONLINE_STATUS: '[Usuário] Atualizar Status Online do Usuário',
} as const;

/** Atualiza um usuário no estado (merge local). */
export const updateUserInState = createAction(
  USER_ACTION_TYPES.UPDATE_USER_IN_STATE,
  props<{ uid: string; updatedData: IUserDados }>()
);

/** Define o usuário atual no state. */
export const setCurrentUser = createAction(
  USER_ACTION_TYPES.SET_CURRENT_USER,
  props<{ user: IUserDados }>()
);

/** Remove o usuário atual do state. */
export const clearCurrentUser = createAction(USER_ACTION_TYPES.CLEAR_CURRENT_USER);

/** Carrega todos os usuários. */
export const loadUsers = createAction(USER_ACTION_TYPES.LOAD_USERS);

export const loadUsersSuccess = createAction(
  USER_ACTION_TYPES.LOAD_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

export const loadUsersFailure = createAction(
  USER_ACTION_TYPES.LOAD_USERS_FAILURE,
  props<{ error: IError }>()
);

export const startOnlineUsersListener = createAction(
  '[Usuário] Start Online Users Listener'
);

export const stopOnlineUsersListener = createAction(
  '[Usuário] Stop Online Users Listener'
);

/**
 * @deprecated
 * Presença oficial NÃO usa isso.
 * Mantido apenas para não quebrar imports antigos enquanto você migra tudo.
 */
export const updateUserOnlineStatus = createAction(
  USER_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS,
  props<{ uid: string; isOnline: boolean }>()
);

/** Adiciona um usuário específico no estado (ex.: realtime individual). */
export const addUserToState = createAction(
  USER_ACTION_TYPES.ADD_USER_TO_STATE,
  props<{ user: IUserDados }>()
);

/** Dispara carregamento de online users (normalmente via PresenceQuery). */
export const loadOnlineUsers = createAction(USER_ACTION_TYPES.LOAD_ONLINE_USERS);

export const loadOnlineUsersSuccess = createAction(
  USER_ACTION_TYPES.LOAD_ONLINE_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

export const loadOnlineUsersFailure = createAction(
  USER_ACTION_TYPES.LOAD_ONLINE_USERS_FAILURE,
  props<{ error: any }>()
);

/** Define lista filtrada (apenas UI). */
export const setFilteredOnlineUsers = createAction(
  USER_ACTION_TYPES.SET_FILTERED_ONLINE_USERS,
  props<{ filteredUsers: IUserDados[] }>()
);

export const observeUserChanges = createAction(
  USER_ACTION_TYPES.OBSERVE_USER_CHANGES,
  props<{ uid: string }>()
);

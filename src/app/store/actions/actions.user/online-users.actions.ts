// src/app/store/actions/actions.user/online-users.actions.ts
// =============================================================================
// ONLINE USERS ACTIONS (NgRx) — domínio específico
//
// Objetivo:
// - Separar ações de Online Users do user.actions.ts (migração gradual).
// - Manter type strings idênticas às atuais (compat total com reducer/effects).
// =============================================================================

import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IError } from 'src/app/core/interfaces/ierror';

// Type strings (mantidos iguais aos que já existem no projeto)
export const ONLINE_USERS_ACTION_TYPES = {
  LOAD_ONLINE_USERS: '[Usuário] Carregar Usuários Online',
  LOAD_ONLINE_USERS_SUCCESS: '[Usuário] Carregar Usuários Online com Sucesso',
  LOAD_ONLINE_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários Online',

  START_ONLINE_USERS_LISTENER: '[Usuário] Start Online Users Listener',
  STOP_ONLINE_USERS_LISTENER: '[Usuário] Stop Online Users Listener',

  SET_FILTERED_ONLINE_USERS: '[Usuário] Definir Usuários Online Filtrados',
} as const;

/** One-shot: snapshot único (opcional; seu effect pode preferir listener). */
export const loadOnlineUsers = createAction(ONLINE_USERS_ACTION_TYPES.LOAD_ONLINE_USERS);

export const loadOnlineUsersSuccess = createAction(
  ONLINE_USERS_ACTION_TYPES.LOAD_ONLINE_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

export const loadOnlineUsersFailure = createAction(
  ONLINE_USERS_ACTION_TYPES.LOAD_ONLINE_USERS_FAILURE,
  props<{ error: IError }>()
);

/** Listener realtime (start/stop) */
export const startOnlineUsersListener = createAction(ONLINE_USERS_ACTION_TYPES.START_ONLINE_USERS_LISTENER);
export const stopOnlineUsersListener = createAction(ONLINE_USERS_ACTION_TYPES.STOP_ONLINE_USERS_LISTENER);

/** Filtro (apenas UI) */
export const setFilteredOnlineUsers = createAction(
  ONLINE_USERS_ACTION_TYPES.SET_FILTERED_ONLINE_USERS,
  props<{ filteredUsers: IUserDados[] }>()
);

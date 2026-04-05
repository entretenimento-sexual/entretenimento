import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IError } from 'src/app/core/interfaces/ierror';

/**
 * =============================================================================
 * ONLINE USERS ACTIONS (NgRx)
 * =============================================================================
 *
 * Responsabilidade deste arquivo:
 * - actions específicas do domínio "usuários online"
 * - manter separado do arquivo principal de user.actions.ts
 *
 * Regra importante:
 * - ESTE arquivo define as actions
 * - user.actions.ts pode reexportar estas actions
 * - ESTE arquivo NÃO deve reexportar a si mesmo nem importar user.actions.ts
 *
 * Motivo:
 * - evita circularidade de alias/import entre barrels e arquivos-fonte
 * - elimina erros TS2303 de definição circular
 */

// ----------------------------------------------------------------------------
// Tipos padronizados
// ----------------------------------------------------------------------------

export const ONLINE_USERS_ACTION_TYPES = {
  LOAD_ONLINE_USERS: '[Usuário] Carregar Usuários Online',
  LOAD_ONLINE_USERS_SUCCESS: '[Usuário] Carregar Usuários Online com Sucesso',
  LOAD_ONLINE_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários Online',
  START_ONLINE_USERS_LISTENER: '[Usuário] Start Online Users Listener',
  STOP_ONLINE_USERS_LISTENER: '[Usuário] Stop Online Users Listener',
  SET_FILTERED_ONLINE_USERS: '[Usuário] Definir Usuários Online Filtrados',
} as const;

// ----------------------------------------------------------------------------
// Snapshot / one-shot
// ----------------------------------------------------------------------------

export const loadOnlineUsers = createAction(
  ONLINE_USERS_ACTION_TYPES.LOAD_ONLINE_USERS
);

export const loadOnlineUsersSuccess = createAction(
  ONLINE_USERS_ACTION_TYPES.LOAD_ONLINE_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

export const loadOnlineUsersFailure = createAction(
  ONLINE_USERS_ACTION_TYPES.LOAD_ONLINE_USERS_FAILURE,
  props<{ error: IError }>()
);

// ----------------------------------------------------------------------------
// Listener lifecycle
// ----------------------------------------------------------------------------

export const startOnlineUsersListener = createAction(
  ONLINE_USERS_ACTION_TYPES.START_ONLINE_USERS_LISTENER
);

export const stopOnlineUsersListener = createAction(
  ONLINE_USERS_ACTION_TYPES.STOP_ONLINE_USERS_LISTENER
);

// ----------------------------------------------------------------------------
// UI-only filtering
// ----------------------------------------------------------------------------

export const setFilteredOnlineUsers = createAction(
  ONLINE_USERS_ACTION_TYPES.SET_FILTERED_ONLINE_USERS,
  props<{ filteredUsers: IUserDados[] }>()
);
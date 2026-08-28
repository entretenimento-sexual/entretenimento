import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IError } from 'src/app/core/interfaces/ierror';

/**
 * =============================================================================
 * USER ACTIONS (NgRx) — padrão “plataforma grande”
 * =============================================================================
 *
 * Responsabilidade deste arquivo:
 * - Ações do “domínio usuário” (perfil, loads gerais, realtime do doc users/{uid}).
 * - Manter COMPAT com imports legados.
 *
 * Presença (importante):
 * - PresenceService é o writer único de isOnline/lastSeen.
 * - NgRx NÃO deve simular online/offline.
 * - OnlineUsers vem de query Firestore (ex.: where('isOnline','==',true)).
 */

// ----------------------------------------------------------------------------
// Tipos padronizados
// ----------------------------------------------------------------------------
export const USER_ACTION_TYPES = {
  SET_CURRENT_USER: '[Usuário] Definir Usuário Atual',
  CLEAR_CURRENT_USER: '[Usuário] Limpar Usuário Atual',

  /**
   * Flags explícitas do ciclo do current user.
   */
  SET_CURRENT_USER_UNAVAILABLE: '[Usuário] Current User Unavailable',
  SET_CURRENT_USER_HYDRATION_ERROR: '[Usuário] Current User Hydration Error',

  LOAD_USERS: '[Usuário] Carregar Usuários',
  LOAD_USERS_SUCCESS: '[Usuário] Carregar Usuários com Sucesso',
  LOAD_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários',

  LOAD_ONLINE_USERS: '[Usuário] Carregar Usuários Online',
  LOAD_ONLINE_USERS_SUCCESS: '[Usuário] Carregar Usuários Online com Sucesso',
  LOAD_ONLINE_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários Online',
  START_ONLINE_USERS_LISTENER: '[Usuário] Start Online Users Listener',
  STOP_ONLINE_USERS_LISTENER: '[Usuário] Stop Online Users Listener',
  SET_FILTERED_ONLINE_USERS: '[Usuário] Definir Usuários Online Filtrados',

  ADD_USER_TO_STATE: '[Usuário] Adicionar Usuário ao Estado',
  UPDATE_USER_IN_STATE: '[Usuário] Atualizar Usuário no Estado',

  OBSERVE_USER_CHANGES: '[Usuário] Observar Mudanças no Usuário',
  STOP_OBSERVE_USER_CHANGES: '[Usuário] Stop Observe User Changes',

  /**
   * @deprecated
   * Presença oficial NÃO usa isso.
   */
  UPDATE_USER_ONLINE_STATUS: '[Usuário] Atualizar Status Online do Usuário',
} as const;

// ----------------------------------------------------------------------------
// Current user
// ----------------------------------------------------------------------------

export const setCurrentUser = createAction(
  USER_ACTION_TYPES.SET_CURRENT_USER,
  props<{ user: IUserDados }>()
);

export const clearCurrentUser = createAction(
  USER_ACTION_TYPES.CLEAR_CURRENT_USER
);

/**
 * Doc do usuário não encontrado / indisponível no ciclo atual.
 * Importante:
 * - não significa logout
 * - não derruba sessão
 * - apenas informa que o perfil do app não está hidratado
 */
export const setCurrentUserUnavailable = createAction(
  USER_ACTION_TYPES.SET_CURRENT_USER_UNAVAILABLE,
  props<{ error: IError }>()
);

/**
 * Erro de stream/observação do users/{uid}.
 * Diferente de "unavailable":
 * - aqui pode existir perfil anterior válido em memória
 * - não limpamos agressivamente como se fosse logout
 */
export const setCurrentUserHydrationError = createAction(
  USER_ACTION_TYPES.SET_CURRENT_USER_HYDRATION_ERROR,
  props<{ error: IError }>()
);

// ----------------------------------------------------------------------------
// Loads gerais
// ----------------------------------------------------------------------------

export const loadUsers = createAction(USER_ACTION_TYPES.LOAD_USERS);

export const loadUsersSuccess = createAction(
  USER_ACTION_TYPES.LOAD_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

export const loadUsersFailure = createAction(
  USER_ACTION_TYPES.LOAD_USERS_FAILURE,
  props<{ error: IError }>()
);

// ----------------------------------------------------------------------------
// Online users — re-export
// ----------------------------------------------------------------------------
export {
  loadOnlineUsers,
  loadOnlineUsersSuccess,
  loadOnlineUsersFailure,
  startOnlineUsersListener,
  stopOnlineUsersListener,
  setFilteredOnlineUsers,
} from './online-users.actions';

// ----------------------------------------------------------------------------
// Upserts
// ----------------------------------------------------------------------------

export const updateUserInState = createAction(
  USER_ACTION_TYPES.UPDATE_USER_IN_STATE,
  props<{ uid: string; updatedData: IUserDados }>()
);

export const addUserToState = createAction(
  USER_ACTION_TYPES.ADD_USER_TO_STATE,
  props<{ user: IUserDados }>()
);

// ----------------------------------------------------------------------------
// Realtime current user
// ----------------------------------------------------------------------------

export const observeUserChanges = createAction(
  USER_ACTION_TYPES.OBSERVE_USER_CHANGES,
  props<{ uid: string }>()
);

export const stopObserveUserChanges = createAction(
  USER_ACTION_TYPES.STOP_OBSERVE_USER_CHANGES
);

// ----------------------------------------------------------------------------
// Deprecated
// ----------------------------------------------------------------------------

export const updateUserOnlineStatus = createAction(
  USER_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS,
  props<{ uid: string; isOnline: boolean }>()
);

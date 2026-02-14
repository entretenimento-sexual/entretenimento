// src/app/store/actions/actions.user/user.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IError } from 'src/app/core/interfaces/ierror';

/**
 * =============================================================================
 * USER ACTIONS (NgRx)
 * =============================================================================
 *
 * IMPORTANTE (presença):
 * - PresenceService é o writer único de isOnline/lastSeen.
 * - NgRx NÃO deve simular online/offline.
 * - OnlineUsers deve vir de query Firestore (ex.: where('isOnline','==',true)).
 *
 * IMPORTANTE (user realtime):
 * - observeUserChanges({uid}) inicia o listener realtime do doc users/{uid}.
 * - stopObserveUserChanges() encerra explicitamente o listener (logout / sessão perdida).
 * - Esse STOP é necessário porque o effect antigo filtrava uid vazio e não “cancelava” o listener.
 */

// ----------------------------------------------------------------------------
// Tipos padronizados (evita strings soltas e facilita refactor/grep)
// ----------------------------------------------------------------------------
export const USER_ACTION_TYPES = {
  // Usuário atual (seleção / UI)
  SET_CURRENT_USER: '[Usuário] Definir Usuário Atual',
  CLEAR_CURRENT_USER: '[Usuário] Limpar Usuário Atual',

  // CRUD/loads gerais
  LOAD_USERS: '[Usuário] Carregar Usuários',
  LOAD_USERS_SUCCESS: '[Usuário] Carregar Usuários com Sucesso',
  LOAD_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários',

  // Online users (lista)
  LOAD_ONLINE_USERS: '[Usuário] Carregar Usuários Online',
  LOAD_ONLINE_USERS_SUCCESS: '[Usuário] Carregar Usuários Online com Sucesso',
  LOAD_ONLINE_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários Online',

  // Upserts pontuais (merge local / realtime individual)
  ADD_USER_TO_STATE: '[Usuário] Adicionar Usuário ao Estado',
  UPDATE_USER_IN_STATE: '[Usuário] Atualizar Usuário no Estado',

  // Filtro (apenas UI)
  SET_FILTERED_ONLINE_USERS: '[Usuário] Definir Usuários Online Filtrados',

  // Listener realtime do usuário atual (doc users/{uid})
  OBSERVE_USER_CHANGES: '[Usuário] Observar Mudanças no Usuário',

  /**
   * ✅ Novo:
   * Permite parar o listener realtime do usuário (cancelamento explícito).
   * Usado no AuthSessionSyncEffects quando uid fica null (logout / token expirou / sessão caiu).
   */
  STOP_OBSERVE_USER_CHANGES: '[Usuário] Stop Observe User Changes',

  /**
   * @deprecated
   * Não usar para presença oficial.
   * Mantido por compatibilidade com fluxos antigos.
   */
  UPDATE_USER_ONLINE_STATUS: '[Usuário] Atualizar Status Online do Usuário',
} as const;

// ----------------------------------------------------------------------------
// Ações do usuário atual (state principal)
// ----------------------------------------------------------------------------

/** Define o usuário atual no state (normalmente derivado de users/{uid}). */
export const setCurrentUser = createAction(
  USER_ACTION_TYPES.SET_CURRENT_USER,
  props<{ user: IUserDados }>()
);

/** Remove o usuário atual do state (ex.: logout, sessão perdida). */
export const clearCurrentUser = createAction(USER_ACTION_TYPES.CLEAR_CURRENT_USER);

// ----------------------------------------------------------------------------
// Loads gerais (lista de usuários)
// ----------------------------------------------------------------------------

/** Carrega todos os usuários (uso pontual/admin/listas). */
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
// Online users (presença via query; não via “toggle” no store)
// ----------------------------------------------------------------------------

/**
 * Dispara carregamento de online users (normalmente via PresenceQuery).
 * Observação: seus effects podem preferir start/stop listener em vez de “load”.
 */
export const loadOnlineUsers = createAction(USER_ACTION_TYPES.LOAD_ONLINE_USERS);

export const loadOnlineUsersSuccess = createAction(
  USER_ACTION_TYPES.LOAD_ONLINE_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

export const loadOnlineUsersFailure = createAction(
  USER_ACTION_TYPES.LOAD_ONLINE_USERS_FAILURE,
  props<{ error: any }>()
);

/**
 * Start/Stop do listener de usuários online.
 * Mantido fora de USER_ACTION_TYPES porque já está espalhado em imports antigos.
 * (Se quiser, você pode padronizar depois dentro do const.)
 */
export const startOnlineUsersListener = createAction('[Usuário] Start Online Users Listener');
export const stopOnlineUsersListener = createAction('[Usuário] Stop Online Users Listener');

/** Define lista filtrada (apenas UI). */
export const setFilteredOnlineUsers = createAction(
  USER_ACTION_TYPES.SET_FILTERED_ONLINE_USERS,
  props<{ filteredUsers: IUserDados[] }>()
);

// ----------------------------------------------------------------------------
// Upserts pontuais no state (merge local)
// ----------------------------------------------------------------------------

/**
 * Atualiza um usuário no estado (merge local).
 * Útil para patches locais de UI (ex.: nickname, foto), mas cuidado para não conflitar com realtime.
 */
export const updateUserInState = createAction(
  USER_ACTION_TYPES.UPDATE_USER_IN_STATE,
  props<{ uid: string; updatedData: IUserDados }>()
);

/**
 * Adiciona um usuário específico no estado (ex.: realtime individual / lazy load).
 * Observação: em muitos casos o loadUsersSuccess já cobre isso, mas mantemos para flexibilidade.
 */
export const addUserToState = createAction(
  USER_ACTION_TYPES.ADD_USER_TO_STATE,
  props<{ user: IUserDados }>()
);

// ----------------------------------------------------------------------------
// Realtime: listener do doc do usuário atual (users/{uid})
// ----------------------------------------------------------------------------

/**
 * Inicia observação realtime do documento do usuário.
 * Geralmente é disparado pelo AuthSessionSyncEffects assim que a sessão estiver pronta e houver uid.
 */
export const observeUserChanges = createAction(
  USER_ACTION_TYPES.OBSERVE_USER_CHANGES,
  props<{ uid: string }>()
);

/**
 * Para o listener realtime do usuário.
 * Deve ser disparado quando uid fica null (logout) para matar listeners “zumbis”.
 */
export const stopObserveUserChanges = createAction(
  USER_ACTION_TYPES.STOP_OBSERVE_USER_CHANGES
);

// ----------------------------------------------------------------------------
// Deprecated (compat)
// ----------------------------------------------------------------------------

/**
 * @deprecated
 * Presença oficial NÃO usa isso.
 * Mantido apenas para não quebrar imports antigos enquanto você migra tudo.
 */
export const updateUserOnlineStatus = createAction(
  USER_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS,
  props<{ uid: string; isOnline: boolean }>()
);

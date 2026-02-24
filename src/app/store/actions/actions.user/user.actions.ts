// src/app/store/actions/actions.user/user.actions.ts
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
 *
 * Migração gradual:
 * - As ações de Online Users foram extraídas para:
 *   ./online-users.actions.ts
 * - Este arquivo RE-EXPORTA essas actions para não quebrar imports antigos.
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

  // --------------------------------------------------------------------------
  // Online Users (domínio extraído)
  // Mantemos as strings aqui por compat e para grep/refactor global.
  // As actions reais são definidas em ./online-users.actions.ts e re-exportadas abaixo.
  // --------------------------------------------------------------------------
  LOAD_ONLINE_USERS: '[Usuário] Carregar Usuários Online',
  LOAD_ONLINE_USERS_SUCCESS: '[Usuário] Carregar Usuários Online com Sucesso',
  LOAD_ONLINE_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários Online',
  START_ONLINE_USERS_LISTENER: '[Usuário] Start Online Users Listener',
  STOP_ONLINE_USERS_LISTENER: '[Usuário] Stop Online Users Listener',
  SET_FILTERED_ONLINE_USERS: '[Usuário] Definir Usuários Online Filtrados',

  // Upserts pontuais (merge local / realtime individual)
  ADD_USER_TO_STATE: '[Usuário] Adicionar Usuário ao Estado',
  UPDATE_USER_IN_STATE: '[Usuário] Atualizar Usuário no Estado',

  // Listener realtime do usuário atual (doc users/{uid})
  OBSERVE_USER_CHANGES: '[Usuário] Observar Mudanças no Usuário',

  /**
   * Parar listener realtime do usuário (cancelamento explícito).
   * Disparado quando uid fica null (logout / token expirou / sessão caiu).
   */
  STOP_OBSERVE_USER_CHANGES: '[Usuário] Stop Observe User Changes',

  /**
   * @deprecated
   * Presença oficial NÃO usa isso.
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
// Online users (domínio extraído) — RE-EXPORT (migração gradual)
// ----------------------------------------------------------------------------
// Importante:
// - Não definimos actions aqui para evitar "export redeclared".
// - Mantemos compat total: quem importa de user.actions.ts continua funcionando.
// - Novos imports podem ir direto para ./online-users.actions.ts.
export {
  loadOnlineUsers,
  loadOnlineUsersSuccess,
  loadOnlineUsersFailure,
  startOnlineUsersListener,
  stopOnlineUsersListener,
  setFilteredOnlineUsers,
} from './online-users.actions';

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
export const stopObserveUserChanges = createAction(USER_ACTION_TYPES.STOP_OBSERVE_USER_CHANGES);

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

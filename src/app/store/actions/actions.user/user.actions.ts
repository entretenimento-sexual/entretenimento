// src\app\store\actions\actions.user\user.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IError } from 'src/app/core/interfaces/ierror';

// Ações relacionadas ao estado do usuário
export const USER_ACTION_TYPES = {
  // Define o usuário atualmente logado
  SET_CURRENT_USER: '[Usuário] Definir Usuário Atual',

  // Remove o usuário atualmente logado
  CLEAR_CURRENT_USER: '[Usuário] Limpar Usuário Atual',

  // Inicia o processo de carregamento de todos os usuários
  LOAD_USERS: '[Usuário] Carregar Usuários',

  // Dispara quando o carregamento de usuários é bem-sucedido
  LOAD_USERS_SUCCESS: '[Usuário] Carregar Usuários com Sucesso',

  // Dispara quando ocorre um erro ao carregar os usuários
  LOAD_USERS_FAILURE: '[Usuário] Falha ao Carregar Usuários',

  // Atualiza o status online de um usuário específico
  UPDATE_USER_ONLINE_STATUS: '[Usuário] Atualizar Status Online do Usuário',

  // Adiciona um usuário específico ao estado
  ADD_USER_TO_STATE: '[Usuário] Adicionar Usuário ao Estado',

  // Dispara quando os usuários online são carregados com sucesso
  LOAD_ONLINE_USERS_SUCCESS: '[Usuário] Carregar Usuários Online com Sucesso',

  // Define usuários online filtrados
  SET_FILTERED_ONLINE_USERS: '[Usuário] Definir Usuários Online Filtrados',

  // Observa mudanças no estado de um usuário específico
  OBSERVE_USER_CHANGES: '[Usuário] Observar Mudanças no Usuário',
};

// Ações para gerenciar o estado do usuário

/**
 * Define o usuário atual no estado.
 * @param user - Objeto do usuário logado.
 */
export const setCurrentUser = createAction(
  USER_ACTION_TYPES.SET_CURRENT_USER,
  props<{ user: IUserDados }>()
);

/**
 * Remove o usuário atual do estado.
 */
export const clearCurrentUser = createAction(USER_ACTION_TYPES.CLEAR_CURRENT_USER);

/**
 * Dispara o carregamento de todos os usuários.
 */
export const loadUsers = createAction(USER_ACTION_TYPES.LOAD_USERS);

/**
 * Ação disparada quando os usuários são carregados com sucesso.
 * @param users - Lista de usuários retornada.
 */
export const loadUsersSuccess = createAction(
  USER_ACTION_TYPES.LOAD_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

/**
 * Ação disparada quando ocorre uma falha ao carregar usuários.
 * @param error - Detalhes do erro ocorrido.
 */
export const loadUsersFailure = createAction(
  USER_ACTION_TYPES.LOAD_USERS_FAILURE,
  props<{ error: IError }>()
);

/**
 * Atualiza o status online de um usuário específico.
 * @param uid - Identificador único do usuário.
 * @param isOnline - Novo status online do usuário.
 */
export const updateUserOnlineStatus = createAction(
  USER_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS,
  props<{ uid: string; isOnline: boolean }>()
);

/**
 * Adiciona um usuário específico ao estado.
 * @param user - Usuário a ser adicionado ao estado.
 */
export const addUserToState = createAction(
  USER_ACTION_TYPES.ADD_USER_TO_STATE,
  props<{ user: IUserDados }>()
);

/**
 * Dispara o carregamento de usuários online.
 */
export const loadOnlineUsers = createAction('[Usuário] Carregar Usuários Online');

/**
 * Dispara quando os usuários online são carregados com sucesso.
 * @param users - Lista de usuários online.
 */
export const loadOnlineUsersSuccess = createAction(
  USER_ACTION_TYPES.LOAD_ONLINE_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

/**
 * Dispara quando ocorre uma falha ao carregar usuários online.
 * @param error - Detalhes do erro ocorrido.
 */
export const loadOnlineUsersFailure = createAction(
  '[Usuário] Falha ao Carregar Usuários Online',
  props<{ error: IError }>()
);

/**
 * Define a lista de usuários online filtrados.
 * @param filteredUsers - Lista de usuários online filtrados.
 */
export const setFilteredOnlineUsers = createAction(
  USER_ACTION_TYPES.SET_FILTERED_ONLINE_USERS,
  props<{ filteredUsers: IUserDados[] }>()
);

/**
 * Observa mudanças em um usuário específico no estado.
 * @param uid - Identificador único do usuário a ser observado.
 */
export const observeUserChanges = createAction(
  USER_ACTION_TYPES.OBSERVE_USER_CHANGES,
  props<{ uid: string }>()
);

// Logs para facilitar depuração e rastreamento
console.log('[Usuário] Actions carregadas:');
console.log('  - Definir Usuário Atual:', USER_ACTION_TYPES.SET_CURRENT_USER);
console.log('  - Limpar Usuário Atual:', USER_ACTION_TYPES.CLEAR_CURRENT_USER);
console.log('  - Carregar Usuários:', USER_ACTION_TYPES.LOAD_USERS);
console.log('  - Carregar Usuários com Sucesso:', USER_ACTION_TYPES.LOAD_USERS_SUCCESS);
console.log('  - Falha ao Carregar Usuários:', USER_ACTION_TYPES.LOAD_USERS_FAILURE);
console.log('  - Atualizar Status Online:', USER_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS);
console.log('  - Adicionar Usuário ao Estado:', USER_ACTION_TYPES.ADD_USER_TO_STATE);
console.log('  - Carregar Usuários Online com Sucesso:', USER_ACTION_TYPES.LOAD_ONLINE_USERS_SUCCESS);
console.log('  - Definir Usuários Online Filtrados:', USER_ACTION_TYPES.SET_FILTERED_ONLINE_USERS);
console.log('  - Observar Mudanças no Usuário:', USER_ACTION_TYPES.OBSERVE_USER_CHANGES);

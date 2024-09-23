// src/app/store/actions/user.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export const observeUserChanges = createAction(
  '[User] Observe User Changes',
  props<{ uid: string }>()
);

export const updateUserRole = createAction(
  '[User] Update User Role',
  props<{ uid: string, newRole: string }>()
);

/**
 * Ação para iniciar o carregamento de todos os usuários.
 * Útil para iniciar o processo de busca de usuários na base de dados.
 */
export const loadUsers = createAction('[User] Load Users');

/**
 * Ação disparada quando os usuários são carregados com sucesso.
 * Contém a lista de usuários carregados.
 */
export const loadUsersSuccess = createAction(
  '[User] Load Users Success',
  props<{ users: IUserDados[] }>()
);

/**
 * Ação disparada quando ocorre um erro ao carregar os usuários.
 * Contém o erro ocorrido.
 */
export const loadUsersFailure = createAction(
  '[User] Load Users Failure',
  props<{ error: any }>()
);

/**
 * Ação para iniciar o processo de atualização do status online de um usuário.
 * Pode ser usada para definir um usuário como online ou offline.
 */
export const updateUserOnlineStatus = createAction(
  '[User] Update Online Status',
  props<{ uid: string, isOnline: boolean }>()
);

/**
 * Ação disparada quando o status online de um usuário é atualizado com sucesso.
 * Confirma a atualização do status online do usuário.
 */
export const updateUserOnlineStatusSuccess = createAction(
  '[User] Update Online Status Success',
  props<{ uid: string, isOnline: boolean }>()
);

/**
 * Ação disparada quando ocorre um erro ao atualizar o status online de um usuário.
 * Contém o erro ocorrido.
 */
export const updateUserOnlineStatusFailure = createAction(
  '[User] Update Online Status Failure',
  props<{ error: any }>()
);

/**
 * Ação para iniciar o carregamento de todos os usuários online.
 * Focada na obtenção apenas dos usuários que estão online.
 */
export const loadOnlineUsers = createAction('[User] Load Online Users');

/**
 * Ação disparada quando os usuários online são carregados com sucesso.
 * Contém a lista de usuários que estão online.
 */
export const loadOnlineUsersSuccess = createAction(
  '[User] Load Online Users Success',
  props<{ users: IUserDados[] }>()
);

/**
 * Ação disparada quando ocorre um erro ao carregar os usuários online.
 * Contém o erro ocorrido.
 */
export const loadOnlineUsersFailure = createAction(
  '[User] Load Online Users Failure',
  props<{ error: any }>()
);

/**
 * Ação para definir a lista de usuários online filtrados com base em critérios específicos,
 * como município ou outras condições. Útil para exibir apenas os usuários relevantes ao usuário logado.
 */
export const setFilteredOnlineUsers = createAction(
  '[User] Set Filtered Online Users',
  props<{ filteredUsers: IUserDados[] }>()
);


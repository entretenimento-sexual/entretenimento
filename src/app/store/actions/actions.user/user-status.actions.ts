// src/app/store/actions/user-status.actions.ts
import { createAction, props } from '@ngrx/store';
import { IError } from 'src/app/core/interfaces/ierror';

/**
 * Ações de Status de Usuário
 * Focado em gerenciar o estado de status dos usuários, como atualização do status online ou offline.
 */
export const USER_STATUS_ACTION_TYPES = {
  UPDATE_USER_ONLINE_STATUS: '[User Status] Atualizar Status Online',
  UPDATE_USER_ONLINE_STATUS_SUCCESS: '[User Status] Atualizar Status Online com Sucesso',
  UPDATE_USER_ONLINE_STATUS_FAILURE: '[User Status] Falha ao Atualizar Status Online',
};

/**
 * Ações para gerenciar o status de usuários
 */

// Ação para iniciar a atualização do status online
export const updateUserOnlineStatus = createAction(
  USER_STATUS_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS,
  props<{ uid: string; isOnline: boolean }>()
);

// Ação para sucesso na atualização do status online
export const updateUserOnlineStatusSuccess = createAction(
  USER_STATUS_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS_SUCCESS,
  props<{ uid: string; isOnline: boolean }>()
);

// Ação para falha na atualização do status online
export const updateUserOnlineStatusFailure = createAction(
  USER_STATUS_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS_FAILURE,
  props<{ error: IError }>()
);

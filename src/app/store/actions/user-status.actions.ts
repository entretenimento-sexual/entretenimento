// src/app/store/actions/user-status.actions.ts
import { createAction, props } from '@ngrx/store';
import { IError } from 'src/app/core/interfaces/ierror';

/**
 * User Status Action Types
 */
export const USER_STATUS_ACTION_TYPES = {
  UPDATE_USER_ONLINE_STATUS: '[User Status] Update Online Status',
  UPDATE_USER_ONLINE_STATUS_SUCCESS: '[User Status] Update Online Status Success',
  UPDATE_USER_ONLINE_STATUS_FAILURE: '[User Status] Update Online Status Failure',
};

/**
 * Action to initiate the process of updating a user's online status.
 * Can be used to set a user as online or offline.
 */
export const updateUserOnlineStatus = createAction(
  USER_STATUS_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS,
  props<{ uid: string; isOnline: boolean }>()
);

/**
 * Action dispatched when a user's online status is successfully updated.
 * Confirms the update of the user's online status.
 */
export const updateUserOnlineStatusSuccess = createAction(
  USER_STATUS_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS_SUCCESS,
  props<{ uid: string; isOnline: boolean }>()
);

/**
 * Action dispatched when an error occurs while updating a user's online status.
 * Contains the occurred error.
 */
export const updateUserOnlineStatusFailure = createAction(
  USER_STATUS_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS_FAILURE,
  props<{ error: IError }>()
);

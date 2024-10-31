// src/app/store/actions/user-role.actions.ts
import { createAction, props } from '@ngrx/store';
import { IError } from 'src/app/core/interfaces/ierror';

/**
 * User Role Action Types
 */
export const USER_ROLE_ACTION_TYPES = {
  UPDATE_USER_ROLE: '[User Role] Update User Role',
  UPDATE_USER_ROLE_SUCCESS: '[User Role] Update User Role Success',
  UPDATE_USER_ROLE_FAILURE: '[User Role] Update User Role Failure',
};

/**
 * Action to initiate the process of updating the user's role.
 * Can be used to change the user's role, such as 'vip', 'premium', etc.
 */
export const updateUserRole = createAction(
  USER_ROLE_ACTION_TYPES.UPDATE_USER_ROLE,
  props<{ uid: string; newRole: string }>()
);

/**
 * Action dispatched when the user's role is successfully updated.
 */
export const updateUserRoleSuccess = createAction(
  USER_ROLE_ACTION_TYPES.UPDATE_USER_ROLE_SUCCESS,
  props<{ uid: string; newRole: string }>()
);

/**
 * Action dispatched when an error occurs while updating the user's role.
 * Contains the occurred error.
 */
export const updateUserRoleFailure = createAction(
  USER_ROLE_ACTION_TYPES.UPDATE_USER_ROLE_FAILURE,
  props<{ error: IError }>()
);

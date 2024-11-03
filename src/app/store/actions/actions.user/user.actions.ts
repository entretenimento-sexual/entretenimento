// src/app/store/actions/user.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IError } from 'src/app/core/interfaces/ierror';

/**
 * User Action Types
 */
export const USER_ACTION_TYPES = {
  OBSERVE_USER_CHANGES: '[User] Observe User Changes',
  SET_CURRENT_USER: '[User] Set Current User',
  CLEAR_CURRENT_USER: '[User] Clear Current User',
  LOAD_USERS: '[User] Load Users',
  LOAD_USERS_SUCCESS: '[User] Load Users Success',
  LOAD_USERS_FAILURE: '[User] Load Users Failure',
  LOAD_ONLINE_USERS: '[User] Load Online Users',
  LOAD_ONLINE_USERS_SUCCESS: '[User] Load Online Users Success',
  LOAD_ONLINE_USERS_FAILURE: '[User] Load Online Users Failure',
  SET_FILTERED_ONLINE_USERS: '[User] Set Filtered Online Users',
  UPDATE_USER_ONLINE_STATUS: '[User] Update User Online Status',
};


// Ação para adicionar o usuário ao estado
export const addUserToState = createAction(
  '[User] Add User to State',
  props<{ user: IUserDados }>()
);

/**
 * Action to observe changes in the current user.
 * Used to watch and update user data as necessary.
 */
export const observeUserChanges = createAction(
  USER_ACTION_TYPES.OBSERVE_USER_CHANGES,
  props<{ uid: string }>()
);

/**
 * Action to set the current user in the state.
 * Used to store the logged-in user's data.
 */
export const setCurrentUser = createAction(
  USER_ACTION_TYPES.SET_CURRENT_USER,
  props<{ user: IUserDados }>()
);

/**
 * Action to clear the current user.
 * Useful when the user logs out or data needs to be reset.
 */
export const clearCurrentUser = createAction(
  USER_ACTION_TYPES.CLEAR_CURRENT_USER
);

/**
 * Action to initiate loading all users.
 * Useful to start fetching users from the database.
 */
export const loadUsers = createAction(USER_ACTION_TYPES.LOAD_USERS);

/**
 * Action dispatched when users are successfully loaded.
 * Contains the list of loaded users.
 */
export const loadUsersSuccess = createAction(
  USER_ACTION_TYPES.LOAD_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

/**
 * Action dispatched when an error occurs while loading users.
 * Contains the occurred error.
 */
export const loadUsersFailure = createAction(
  USER_ACTION_TYPES.LOAD_USERS_FAILURE,
  props<{ error: IError }>()
);

/**
 * Action to initiate loading all online users.
 * Focused on obtaining only users who are online.
 */
export const loadOnlineUsers = createAction(
  USER_ACTION_TYPES.LOAD_ONLINE_USERS
);

/**
 * Action dispatched when online users are successfully loaded.
 * Contains the list of users who are online.
 */
export const loadOnlineUsersSuccess = createAction(
  USER_ACTION_TYPES.LOAD_ONLINE_USERS_SUCCESS,
  props<{ users: IUserDados[] }>()
);

/**
 * Action dispatched when an error occurs while loading online users.
 * Contains the occurred error.
 */
export const loadOnlineUsersFailure = createAction(
  USER_ACTION_TYPES.LOAD_ONLINE_USERS_FAILURE,
  props<{ error: IError }>()
);

/**
 * Action to set the list of filtered online users based on specific criteria,
 * such as municipality or other conditions. Useful to display only users relevant to the logged-in user.
 */
export const setFilteredOnlineUsers = createAction(
  USER_ACTION_TYPES.SET_FILTERED_ONLINE_USERS,
  props<{ filteredUsers: IUserDados[] }>()
);

export const updateUserOnlineStatus = createAction(
  USER_ACTION_TYPES.UPDATE_USER_ONLINE_STATUS,
  props<{ uid: string, isOnline: boolean }>()
);

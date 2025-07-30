//src\app\store\actions\actions.user\auth.actions.ts
import { IUserDados } from "src/app/core/interfaces/iuser-dados";
import { createAction, props } from '@ngrx/store';
import { User } from 'firebase/auth';

// Ações relacionadas ao registro de usuário
export const register = createAction('[Auth] Register', props<{ email: string; password: string; nickname: string }>());
export const registerSuccess = createAction('[Auth] Register Success', props<{ user: User }>());
export const registerFailure = createAction('[Auth] Register Failure', props<{ error: string }>());

// Ações relacionadas ao login e logout
export const loginStart = createAction('[Auth] Login Start');
export const login = createAction('[Auth] Login', props<{ email: string; password: string }>());
export const loginSuccess = createAction('[Auth] Login Success', props<{ user: IUserDados }>());
export const loginFailure = createAction('[Auth] Login Failure', props<{ error: any }>());

export const logout = createAction('[Auth] Logout');
export const logoutSuccess = createAction('[Auth] Logout Success');

export const authFailure = createAction('[Auth] Failure', props<{ error: any }>());

export const updateUserOnlineStatusSuccess = createAction(
  '[Auth] Update User Online Status Success',
  props<{ uid: string, isOnline: boolean }>()
);

export const updateUserOnlineStatusFailure = createAction(
  '[Auth] Update User Online Status Failure',
  props<{ error: any }>()
);

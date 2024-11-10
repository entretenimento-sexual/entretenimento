//src\app\store\actions\auth.actions.ts
import { IUserDados } from "src/app/core/interfaces/iuser-dados";
import { createAction, props } from '@ngrx/store';

export const login = createAction('[Auth] Login', props<{ email: string; password: string }>());
export const loginSuccess = createAction('[Auth] Login Success', props<{ user: IUserDados }>());
export const loginFailure = createAction('[Auth] Login Failure', props<{ error: any }>());

export const logout = createAction('[Auth] Logout');
export const logoutSuccess = createAction('[Auth] Logout Success');
export const userOffline = createAction(  '[Auth] User Offline',  props<{ uid: string }>());

export const authFailure = createAction('[Auth] Failure', props<{ error: any }>());

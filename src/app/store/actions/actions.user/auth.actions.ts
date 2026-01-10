// src/app/store/actions/actions.user/auth.actions.ts
import { createAction, props } from '@ngrx/store';
import { User } from 'firebase/auth';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

/**
 * IMPORTANTE (PRESENÇA):
 * A presença (isOnline/lastSeen/presenceState) é controlada por:
 *   PresenceService  -> Firestore(users) -> Queries -> loadOnlineUsersSuccess
 *
 * Portanto, Auth NÃO deve mais “simular” status online via actions.
 * Ainda assim, mantemos exports LEGADOS para não quebrar imports antigos.
 */

// ================================
// Registro
// ================================
export const register = createAction(
  '[Auth] Register',
  props<{ email: string; password: string; nickname: string }>()
);

export const registerSuccess = createAction(
  '[Auth] Register Success',
  props<{ user: User }>()
);

export const registerFailure = createAction(
  '[Auth] Register Failure',
  props<{ error: string }>()
);

// ================================
// Login / Logout
// ================================
export const loginStart = createAction('[Auth] Login Start');

export const login = createAction(
  '[Auth] Login',
  props<{ email: string; password: string }>()
);

export const loginSuccess = createAction(
  '[Auth] Login Success',
  props<{ user: IUserDados }>()
);

export const loginFailure = createAction(
  '[Auth] Login Failure',
  props<{ error: any }>()
);

export const logout = createAction('[Auth] Logout');
export const logoutSuccess = createAction('[Auth] Logout Success');

export const authFailure = createAction(
  '[Auth] Failure',
  props<{ error: any }>()
);

//por que não usar auth.auth ?
//Action única: “sessão mudou”
export const authSessionChanged = createAction(
  '[AuthSession] Changed',
  props<{ uid: string | null; emailVerified: boolean }>()
);

// ================================
// LEGADO (presença) — não usar mais
// ================================

/**
 * @deprecated
 * Não utilizar em novos fluxos.
 * Mantido somente para não quebrar imports antigos.
 */
export const updateUserOnlineStatusSuccess = createAction(
  '[Auth] (LEGACY) Update User Online Status Success',
  props<{ uid: string; isOnline: boolean }>()
);

/**
 * @deprecated
 * Não utilizar em novos fluxos.
 * Mantido somente para não quebrar imports antigos.
 */
export const updateUserOnlineStatusFailure = createAction(
  '[Auth] (LEGACY) Update User Online Status Failure',
  props<{ error: any }>()
);

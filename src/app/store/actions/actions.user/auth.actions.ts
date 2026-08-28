// src/app/store/actions/actions.user/auth.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

/**
 * =============================================================================
 * AUTH ACTIONS
 * =============================================================================
 * A sessão canônica nasce no Firebase Auth e é refletida por
 * authSessionChanged. Actions de login/registro representam intents e feedback.
 * =============================================================================
 */

export interface RegistrationTermsAcceptance {
  accepted: boolean;
  date: number;
}

// ============================================================================
// Registro
// ============================================================================

/**
 * Intent legada de registro.
 *
 * `acceptedTerms` permanece opcional no tipo apenas para não quebrar imports e
 * chamadas antigas durante a migração. O effect falha fechado quando a evidência
 * não é enviada ou é inválida; ele nunca inventa aceite em nome do usuário.
 */
export const register = createAction(
  '[Auth] Register',
  props<{
    email: string;
    password: string;
    nickname: string;
    acceptedTerms?: RegistrationTermsAcceptance;
  }>()
);

/**
 * Feedback serializável do cadastro.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - o objeto runtime `firebase.User` não atravessa mais a action;
 * - somente os campos simples usados para diagnóstico/telemetria permanecem.
 *
 * Motivo:
 * - strictActionSerializability está habilitado no AppStoreModule;
 * - a sessão oficial continua chegando por authSessionChanged;
 * - o reducer não depende do objeto completo retornado pelo Firebase.
 */
export const registerSuccess = createAction(
  '[Auth] Register Success',
  props<{ uid: string; emailVerified: boolean }>()
);

export const registerFailure = createAction(
  '[Auth] Register Failure',
  props<{ error: string }>()
);

// ============================================================================
// Login / Logout
// ============================================================================

export const loginStart = createAction('[Auth] Login Start');

export const login = createAction(
  '[Auth] Login',
  props<{ email: string; password: string }>()
);

export const loginSuccess = createAction(
  '[Auth] Login Success',
  props<{ user: IUserDados }>()
);

/**
 * Login autenticado enquanto o documento do perfil ainda não foi confirmado.
 * Encerra loading sem materializar um perfil transitório no UserStore.
 */
export const loginSessionReady = createAction('[Auth] Login Session Ready');

export const loginFailure = createAction(
  '[Auth] Login Failure',
  props<{ error: string }>()
);

export const logout = createAction('[Auth] Logout');
export const logoutSuccess = createAction('[Auth] Logout Success');

export const authFailure = createAction(
  '[Auth] Failure',
  props<{ error: string }>()
);

// ============================================================================
// Sessão canônica
// ============================================================================

export const authSessionChanged = createAction(
  '[AuthSession] Changed',
  props<{ uid: string | null; emailVerified: boolean }>()
);

// ============================================================================
// Legado de presença — não usar em novos fluxos
// ============================================================================

/** @deprecated Presença pertence ao PresenceService. */
export const updateUserOnlineStatusSuccess = createAction(
  '[Auth] (LEGACY) Update User Online Status Success',
  props<{ uid: string; isOnline: boolean }>()
);

/** @deprecated Presença pertence ao PresenceService. */
export const updateUserOnlineStatusFailure = createAction(
  '[Auth] (LEGACY) Update User Online Status Failure',
  props<{ error: string }>()
);

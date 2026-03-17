// src/app/store/reducers/reducers.user/auth.reducer.ts
import { createReducer, on } from '@ngrx/store';

import {
  authFailure,
  authSessionChanged,
  login,
  loginFailure,
  loginStart,
  loginSuccess,
  logout,
  logoutSuccess,
  register,
  registerFailure,
  registerSuccess,
} from '../../actions/actions.user/auth.actions';

import {
  AuthState,
  initialAuthState,
} from '../../states/states.user/auth.state';

/**
 * =============================================================================
 * AUTH REDUCER
 * =============================================================================
 *
 * Objetivo:
 * - manter um espelho serializável e previsível do estado de autenticação
 *
 * Fonte da verdade:
 * - authSessionChanged
 *
 * Isso significa:
 * - UID, ready, isAuthenticated e emailVerified devem ser derivados
 *   prioritariamente de authSessionChanged
 * - loginSuccess/registerSuccess servem como apoio de UX
 * - reducer NÃO deve “inventar” sessão a partir de loginSuccess
 *
 * Resultado:
 * - menos competição entre effects / Firebase Auth / store
 * - menos chance de estado inconsistente
 * =============================================================================
 */

export const authReducer = createReducer(
  initialAuthState,

  // ---------------------------------------------------------------------------
  // Sessão canônica
  // ---------------------------------------------------------------------------
  on(authSessionChanged, (state, { uid, emailVerified }): AuthState => ({
    ...state,
    ready: true,
    isAuthenticated: !!uid,
    userId: uid,
    emailVerified: !!uid && emailVerified === true,
    loading: false,
    error: null,
  })),

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  /**
   * loginStart:
   * - usado quando a UI quiser marcar explicitamente o começo do fluxo
   */
  on(loginStart, (state): AuthState => ({
    ...state,
    loading: true,
    error: null,
  })),

  /**
   * login:
   * - também pode iniciar loading diretamente
   * - útil caso a UI dispare login sem loginStart antes
   */
  on(login, (state): AuthState => ({
    ...state,
    loading: true,
    error: null,
  })),

  /**
   * loginSuccess:
   * - não altera userId / isAuthenticated / emailVerified
   * - esses campos pertencem ao authSessionChanged
   *
   * Aqui apenas encerramos loading/erro.
   */
  on(loginSuccess, (state): AuthState => ({
    ...state,
    loading: false,
    error: null,
  })),

  /**
   * loginFailure:
   * - falha real do submit/login
   * - não apaga à força o estado canônico da sessão
   */
  on(loginFailure, (state, { error }): AuthState => ({
    ...state,
    loading: false,
    error,
  })),

  // ---------------------------------------------------------------------------
  // Registro
  // ---------------------------------------------------------------------------

  /**
   * register:
   * - inicia loading para o fluxo de cadastro
   */
  on(register, (state): AuthState => ({
    ...state,
    loading: true,
    error: null,
  })),

  /**
   * registerSuccess:
   * - finaliza loading
   * - a sessão real continua dependente de authSessionChanged
   */
  on(registerSuccess, (state): AuthState => ({
    ...state,
    loading: false,
    error: null,
  })),

  /**
   * registerFailure:
   * - registra erro serializável do cadastro
   */
  on(registerFailure, (state, { error }): AuthState => ({
    ...state,
    loading: false,
    error,
  })),

  // ---------------------------------------------------------------------------
  // Falha genérica de auth
  // ---------------------------------------------------------------------------
  on(authFailure, (state, { error }): AuthState => ({
    ...state,
    loading: false,
    error,
  })),

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------
  on(logout, (state): AuthState => ({
    ...state,
    loading: true,
    error: null,
  })),

  /**
   * logoutSuccess:
   * - reseta o estado
   * - mantém ready=true porque já sabemos que a sessão foi resolvida e é nula
   */
  on(logoutSuccess, (): AuthState => ({
    ...initialAuthState,
    ready: true,
  }))
); // Linha 173, fim do auth.reducer.ts

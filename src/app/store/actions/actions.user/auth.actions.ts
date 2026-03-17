// src/app/store/actions/actions.user/auth.actions.ts
import { createAction, props } from '@ngrx/store';
import { User } from 'firebase/auth';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

/**
 * =============================================================================
 * AUTH ACTIONS
 * =============================================================================
 *
 * Papel deste arquivo:
 * - declarar intents da UI (login, register, logout)
 * - declarar eventos de resultado (success/failure)
 * - declarar o evento canônico de sessão: authSessionChanged
 *
 * Arquitetura atual:
 * - A VERDADE da sessão nasce no Firebase Auth
 * - authSessionChanged é o bridge canônico para o store
 * - loginSuccess/registerSuccess servem para UX e fluxos auxiliares,
 *   mas NÃO devem substituir a verdade do authSessionChanged
 *
 * IMPORTANTE (PRESENÇA):
 * A presença (isOnline/lastSeen/presenceState) é controlada por:
 *   PresenceService -> Firestore(users/presence) -> queries/selectors
 *
 * Portanto:
 * - Auth NÃO deve mais “simular” presença via actions
 * - Mantemos exports legados apenas para não quebrar imports antigos
 * =============================================================================
 */

// ============================================================================
// Registro
// ============================================================================

/**
 * Intent de registro disparada pela UI.
 */
export const register = createAction(
  '[Auth] Register',
  props<{ email: string; password: string; nickname: string }>()
);

/**
 * Registro concluído com sucesso no Firebase Auth.
 *
 * Observação:
 * - isso NÃO substitui authSessionChanged como fonte da sessão
 * - serve para feedback/fluxos auxiliares
 */
export const registerSuccess = createAction(
  '[Auth] Register Success',
  props<{ user: User }>()
);

/**
 * Falha no fluxo de registro.
 */
export const registerFailure = createAction(
  '[Auth] Register Failure',
  props<{ error: string }>()
);

// ============================================================================
// Login / Logout
// ============================================================================

/**
 * Sinaliza início de tentativa de login.
 * Útil para spinner/estado de loading.
 */
export const loginStart = createAction('[Auth] Login Start');

/**
 * Intent de login disparada pela UI.
 */
export const login = createAction(
  '[Auth] Login',
  props<{ email: string; password: string }>()
);

/**
 * Login autenticado com sucesso.
 *
 * IMPORTANTE:
 * - este action não é a fonte da verdade do UID da sessão
 * - a fonte da verdade continua sendo authSessionChanged
 * - pode existir loginSuccess mesmo quando o usuário ainda exige
 *   fluxos adicionais de produto
 */
export const loginSuccess = createAction(
  '[Auth] Login Success',
  props<{ user: IUserDados }>()
);

/**
 * Falha real de login/autenticação.
 *
 * Mantido como string para deixar o estado serializável,
 * previsível e simples de renderizar na UI.
 */
export const loginFailure = createAction(
  '[Auth] Login Failure',
  props<{ error: string }>()
);

/**
 * Intent de logout.
 */
export const logout = createAction('[Auth] Logout');

/**
 * Logout concluído.
 */
export const logoutSuccess = createAction('[Auth] Logout Success');

/**
 * Falha genérica de autenticação/autorização.
 *
 * Mantido separado de loginFailure para cobrir outros cenários
 * fora do submit do login.
 */
export const authFailure = createAction(
  '[Auth] Failure',
  props<{ error: string }>()
);

// ============================================================================
// Sessão canônica
// ============================================================================

/**
 * Evento único e canônico: a sessão do Firebase Auth mudou.
 *
 * Este action é a fonte da verdade para:
 * - ready
 * - isAuthenticated
 * - userId
 * - emailVerified
 *
 * Regras:
 * - uid === null   => sessão nula
 * - uid !== null   => sessão autenticada
 * - emailVerified  => refletido do Firebase Auth/token atual
 */
export const authSessionChanged = createAction(
  '[AuthSession] Changed',
  props<{ uid: string | null; emailVerified: boolean }>()
);

// ============================================================================
// LEGADO (presença) — não usar mais
// ============================================================================

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
  props<{ error: string }>()
); // Linha 173, fim do /auth.actions.ts

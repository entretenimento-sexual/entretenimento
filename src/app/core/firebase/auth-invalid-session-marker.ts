import { isSessionEndReason, type SessionEndReason } from '../services/autentication/auth/auth.types';

/**
 * Marcador local de bloqueio de credencial invalida, separado por UID.
 * Nao armazena senha, token ou estado de autenticacao.
 * Persistencia e uma protecao de UX; autorizacao e sempre no backend.
 */
const PREFIX = 'entretenimento:auth-invalid:v1:';

export function authInvalidMarkerKey(uid: string): string | null {
  const normalized = String(uid || '').trim();
  return normalized ? PREFIX + encodeURIComponent(normalized) : null;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function markAuthInvalidUid(uid: string, reason: SessionEndReason = 'session-expired'): void {
  const key = authInvalidMarkerKey(uid);
  if (!key) return;
  try { storage()?.setItem(key, reason); } catch { /* bloqueio reativo permanece */ }
}

export function readAuthInvalidUid(uid: string): SessionEndReason | null {
  const key = authInvalidMarkerKey(uid);
  if (!key) return null;
  try {
    const value = storage()?.getItem(key);
    if (value === '1') return 'session-expired';
    return isSessionEndReason(value) ? value : null;
  } catch {
    return null;
  }
}

export function hasAuthInvalidUid(uid: string): boolean {
  return readAuthInvalidUid(uid) !== null;
}

export function clearAuthInvalidUid(uid: string): void {
  const key = authInvalidMarkerKey(uid);
  if (!key) return;
  try { storage()?.removeItem(key); } catch { /* sem permissao de storage */ }
}

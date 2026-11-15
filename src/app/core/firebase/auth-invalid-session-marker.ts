/**
 * Marcador local de bloqueio de credencial invalida, separado por UID.
 * Nao armazena senha, token ou estado de autenticacao.
 * Persistencia e uma protecao de UX; autorizacao e sempre no backend.
 */
const PREFIX = 'entretenimento:auth-invalid:v1:';

function keyFor(uid: string): string | null {
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

export function markAuthInvalidUid(uid: string): void {
  const key = keyFor(uid);
  if (!key) return;
  try { storage()?.setItem(key, '1'); } catch { /* bloqueio reativo permanece */ }
}

export function hasAuthInvalidUid(uid: string): boolean {
  const key = keyFor(uid);
  if (!key) return false;
  try { return storage()?.getItem(key) === '1'; } catch { return false; }
}

export function clearAuthInvalidUid(uid: string): void {
  const key = keyFor(uid);
  if (!key) return;
  try { storage()?.removeItem(key); } catch { /* sem permissao de storage */ }
}

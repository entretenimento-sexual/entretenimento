// A intenção sobrevive a um reload da aba durante signOut. Não é credencial.
const KEY = 'entretenimento:pending-logout:v1';

export function readPendingLogout(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

export function savePendingLogout(uid: string): void {
  sessionStorage.setItem(KEY, uid);
}

export function clearPendingLogout(uid: string): void {
  try {
    if (readPendingLogout() === uid) sessionStorage.removeItem(KEY);
  } catch {
    // A sessão operacional permanece protegida pelo LogoutService.
  }
}

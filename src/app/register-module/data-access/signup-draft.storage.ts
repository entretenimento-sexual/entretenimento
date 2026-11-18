// Rascunho temporário de uma aba; nunca salva senha, termos, idade ou UID.
export const SIGNUP_DRAFT_KEY = 'registration:signup-draft:v1';
const TTL_MS = 30 * 60_000;
export interface SignupDraft {
  sectionIndex: 0 | 1 | 2;
  apelidoPrincipal: string;
  complementoApelido: string;
  email: string;
}
type StoredDraft = SignupDraft & { version: 1; updatedAt: number };
const getStorage = (): Storage | null => {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; }
  catch { return null; }
};
export function clearSignupDraft(): void {
  try { getStorage()?.removeItem(SIGNUP_DRAFT_KEY); }
  catch { /* Falha de storage não impede o cadastro. */ }
}
export function readSignupDraft(): SignupDraft | null {
  try {
    const raw = getStorage()?.getItem(SIGNUP_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<StoredDraft>;
    if (d.version !== 1 || typeof d.updatedAt !== 'number' ||
        d.updatedAt > Date.now() || Date.now() - d.updatedAt > TTL_MS ||
        ![0, 1, 2].includes(d.sectionIndex as number) ||
        typeof d.apelidoPrincipal !== 'string' || d.apelidoPrincipal.length > 12 ||
        typeof d.complementoApelido !== 'string' || d.complementoApelido.length > 12 ||
        typeof d.email !== 'string' || d.email.length > 254) {
      clearSignupDraft();
      return null;
    }
    return {
      sectionIndex: d.sectionIndex as 0 | 1 | 2,
      apelidoPrincipal: d.apelidoPrincipal,
      complementoApelido: d.complementoApelido,
      email: d.email,
    };
  } catch {
    clearSignupDraft();
    return null;
  }
}
export function writeSignupDraft(draft: SignupDraft): void {
  try {
    getStorage()?.setItem(SIGNUP_DRAFT_KEY, JSON.stringify({
      ...draft, version: 1, updatedAt: Date.now(),
    } satisfies StoredDraft));
  } catch { /* Opcional e seguro sob quota ou bloqueio de storage. */ }
}

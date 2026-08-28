// src/app/core/guards/compliance/adult-content-consent.storage.ts
// -----------------------------------------------------------------------------
// Cache local versionado do consentimento adulto.
// -----------------------------------------------------------------------------
// A fonte de verdade permanece em users/{uid}.adultConsent. O armazenamento
// local existe apenas para continuidade de UX e fallback temporário por usuário.
// -----------------------------------------------------------------------------

export const ADULT_CONSENT_VERSION = 'v1';
export const ADULT_CONSENT_STORAGE_KEY = `adult-content-consent:${ADULT_CONSENT_VERSION}`;
export const ADULT_CONSENT_VALUE = 'accepted';

function normalizeUid(uid: string): string {
  return String(uid ?? '').trim();
}

function buildAdultConsentStorageKey(uid: string): string | null {
  const safeUid = normalizeUid(uid);

  if (!safeUid) {
    return null;
  }

  return `${ADULT_CONSENT_STORAGE_KEY}:${encodeURIComponent(safeUid)}`;
}

export function hasAdultContentConsent(uid: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const storageKey = buildAdultConsentStorageKey(uid);

  if (!storageKey) {
    return false;
  }

  try {
    return window.localStorage.getItem(storageKey) === ADULT_CONSENT_VALUE;
  } catch {
    return false;
  }
}

export function acceptAdultContentConsent(uid: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const storageKey = buildAdultConsentStorageKey(uid);

  if (!storageKey) {
    return false;
  }

  try {
    window.localStorage.setItem(storageKey, ADULT_CONSENT_VALUE);

    // Remove o formato legado global para impedir que um aceite de outro usuário
    // continue liberando a sessão atual.
    window.localStorage.removeItem(ADULT_CONSENT_STORAGE_KEY);

    return true;
  } catch {
    return false;
  }
}

export function clearAdultContentConsent(uid?: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const storageKey = buildAdultConsentStorageKey(uid ?? '');

    if (storageKey) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    // Limpeza total reservada para recuperação técnica. A recusa normal informa
    // o UID e remove apenas o cache da conta autenticada.
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);

      if (key === ADULT_CONSENT_STORAGE_KEY || key?.startsWith(`${ADULT_CONSENT_STORAGE_KEY}:`)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // noop
  }
}

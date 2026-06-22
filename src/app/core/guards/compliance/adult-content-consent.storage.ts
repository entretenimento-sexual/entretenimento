// src/app/core/guards/compliance/adult-content-consent.storage.ts
// -----------------------------------------------------------------------------
// Storage local versionado para consentimento adulto.
// -----------------------------------------------------------------------------
// Esta camada é UX/compliance local. Não substitui verificação real de idade,
// moderação, KYC ou aceite persistido no backend.
// -----------------------------------------------------------------------------

export const ADULT_CONSENT_STORAGE_KEY = 'adult-content-consent:v1';
export const ADULT_CONSENT_VALUE = 'accepted';

export function hasAdultContentConsent(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return window.localStorage.getItem(ADULT_CONSENT_STORAGE_KEY) === ADULT_CONSENT_VALUE;
  } catch {
    return false;
  }
}

export function acceptAdultContentConsent(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    window.localStorage.setItem(ADULT_CONSENT_STORAGE_KEY, ADULT_CONSENT_VALUE);
    return true;
  } catch {
    return false;
  }
}

export function clearAdultContentConsent(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(ADULT_CONSENT_STORAGE_KEY);
  } catch {
    // noop
  }
}

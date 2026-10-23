/**
 * Future public-profile presentation contract. A commercial organization grant,
 * subscription tier or bio text does NOT establish a professional personal
 * profile. Backend must derive and sanitize this projection after an explicit
 * purpose declaration, public-display choice and the required verification.
 *
 * No persistence, monetization or discovery-ranking behavior is enabled here.
 */
export type ProfileContentPurpose = 'PERSONAL_SOCIAL' | 'PROFESSIONAL';
export type ProfileContentPurposeEvidence =
  | 'SELF_DECLARED'
  | 'BACKEND_VERIFIED';

export interface PublicProfilePurposeProjection {
  readonly schemaVersion: 1;
  readonly purpose: ProfileContentPurpose;
  readonly evidence: ProfileContentPurposeEvidence;
  readonly publishLabel: boolean;
}

export interface ProfilePurposePresentation {
  readonly label: 'Perfil pessoal' | 'Perfil profissional';
  readonly verified: boolean;
}

/** Fail closed: undefined/legacy/unverified-professional profiles have no tag. */
export function resolvePublicProfilePurposePresentation(
  value: unknown
): ProfilePurposePresentation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<PublicProfilePurposeProjection>;
  if (candidate.schemaVersion !== 1 || candidate.publishLabel !== true) {
    return null;
  }
  if (
    candidate.purpose === 'PROFESSIONAL' &&
    candidate.evidence === 'BACKEND_VERIFIED'
  ) {
    return { label: 'Perfil profissional', verified: true };
  }
  if (
    candidate.purpose === 'PERSONAL_SOCIAL' &&
    (candidate.evidence === 'SELF_DECLARED' ||
      candidate.evidence === 'BACKEND_VERIFIED')
  ) {
    return { label: 'Perfil pessoal', verified: false };
  }
  return null;
}

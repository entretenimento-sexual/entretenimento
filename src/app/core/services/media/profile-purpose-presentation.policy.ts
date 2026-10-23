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

/**
 * Separate, future backend-derived label for an individual media publication.
 * Professional label is never inferred from account tier, ranking, video
 * appearance, engagement or a mere self-declaration by the author.
 */
export type MediaPublicationPurpose =
  | 'PERSONAL_SOCIAL'
  | 'PROFESSIONAL_PORTFOLIO';

export interface PublicMediaPurposeProjection {
  readonly schemaVersion: 1;
  readonly purpose: MediaPublicationPurpose;
  readonly publishLabel: boolean;
  /** Backend must validate this against the current owner verification. */
  readonly verifiedOwnerPurpose: PublicProfilePurposeProjection | null;
}

export function resolvePublicMediaPurposePresentation(
  value: unknown
): 'Conteúdo pessoal' | 'Conteúdo profissional' | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Partial<PublicMediaPurposeProjection>;
  if (source.schemaVersion !== 1 || source.publishLabel !== true) return null;

  if (source.purpose === 'PROFESSIONAL_PORTFOLIO') {
    const owner = resolvePublicProfilePurposePresentation(
      source.verifiedOwnerPurpose
    );
    return owner?.verified && owner.label === 'Perfil profissional'
      ? 'Conteúdo profissional'
      : null;
  }
  if (source.purpose === 'PERSONAL_SOCIAL') {
    // Positive, opt-in statement about the publication; not an inference
    // about pricing, profession, or the account as a whole.
    return 'Conteúdo pessoal';
  }
  return null;
}

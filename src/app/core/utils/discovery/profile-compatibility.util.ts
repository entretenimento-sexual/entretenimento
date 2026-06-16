// src/app/core/utils/discovery/profile-compatibility.util.ts
// -----------------------------------------------------------------------------
// ProfileCompatibilityUtils
// -----------------------------------------------------------------------------
// Regra pura de compatibilidade social/sexual para discovery.
// Não consulta Firestore, não conhece UI e não altera dados.

export type NormalizedDiscoveryGender =
  | 'man'
  | 'woman'
  | 'couple'
  | 'unknown';

export type NormalizedDiscoveryOrientation =
  | 'heterosexual'
  | 'homosexual'
  | 'bisexual'
  | 'pansexual'
  | 'unknown';

export type ProfileCompatibilityReason =
  | 'mutual_match'
  | 'viewer_data_missing'
  | 'candidate_data_missing'
  | 'viewer_not_interested'
  | 'candidate_not_interested'
  | 'mutual_mismatch';

export interface ProfileCompatibilityLike {
  uid?: string | null;
  gender?: string | null;
  orientation?: string | null;
  partner1Orientation?: string | null;
  partner2Orientation?: string | null;
}

export interface ProfileCompatibilityResult {
  readonly compatible: boolean;
  readonly score: number; // 0..1
  readonly reason: ProfileCompatibilityReason;
  readonly viewerGender: NormalizedDiscoveryGender;
  readonly viewerOrientation: NormalizedDiscoveryOrientation;
  readonly candidateGender: NormalizedDiscoveryGender;
  readonly candidateOrientation: NormalizedDiscoveryOrientation;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    : '';
}

export function normalizeDiscoveryGender(value: unknown): NormalizedDiscoveryGender {
  const text = normalizeText(value);

  if (
    text === 'homem' ||
    text === 'masculino' ||
    text === 'male' ||
    text === 'man'
  ) {
    return 'man';
  }

  if (
    text === 'mulher' ||
    text === 'feminino' ||
    text === 'female' ||
    text === 'woman'
  ) {
    return 'woman';
  }

  if (
    text === 'casal' ||
    text === 'couple' ||
    text === 'dupla'
  ) {
    return 'couple';
  }

  return 'unknown';
}

export function normalizeDiscoveryOrientation(
  value: unknown
): NormalizedDiscoveryOrientation {
  const text = normalizeText(value);

  if (
    text === 'heterossexual' ||
    text === 'heterosexual' ||
    text === 'hetero'
  ) {
    return 'heterosexual';
  }

  if (
    text === 'homossexual' ||
    text === 'homosexual' ||
    text === 'gay' ||
    text === 'lesbica' ||
    text === 'lesbian'
  ) {
    return 'homosexual';
  }

  if (
    text === 'bissexual' ||
    text === 'bisexual' ||
    text === 'bi'
  ) {
    return 'bisexual';
  }

  if (
    text === 'pansexual' ||
    text === 'pan'
  ) {
    return 'pansexual';
  }

  return 'unknown';
}

function acceptedTargetGenders(
  selfGender: NormalizedDiscoveryGender,
  selfOrientation: NormalizedDiscoveryOrientation
): readonly NormalizedDiscoveryGender[] | null {
  if (selfGender === 'unknown' || selfOrientation === 'unknown') {
    return null;
  }

  if (selfOrientation === 'bisexual' || selfOrientation === 'pansexual') {
    return ['man', 'woman', 'couple'];
  }

  if (selfGender === 'man' && selfOrientation === 'heterosexual') {
    return ['woman'];
  }

  if (selfGender === 'woman' && selfOrientation === 'heterosexual') {
    return ['man'];
  }

  if (selfGender === 'man' && selfOrientation === 'homosexual') {
    return ['man'];
  }

  if (selfGender === 'woman' && selfOrientation === 'homosexual') {
    return ['woman'];
  }

  if (selfGender === 'couple') {
    return ['man', 'woman', 'couple'];
  }

  return null;
}

function acceptsTarget(
  sourceGender: NormalizedDiscoveryGender,
  sourceOrientation: NormalizedDiscoveryOrientation,
  targetGender: NormalizedDiscoveryGender
): boolean | null {
  const accepted = acceptedTargetGenders(sourceGender, sourceOrientation);

  if (!accepted || targetGender === 'unknown') {
    return null;
  }

  return accepted.includes(targetGender);
}

export function evaluateProfileCompatibility(
  viewer: ProfileCompatibilityLike | null | undefined,
  candidate: ProfileCompatibilityLike | null | undefined
): ProfileCompatibilityResult {
  const viewerGender = normalizeDiscoveryGender(viewer?.gender);
  const viewerOrientation = normalizeDiscoveryOrientation(viewer?.orientation);

  const candidateGender = normalizeDiscoveryGender(candidate?.gender);
  const candidateOrientation = normalizeDiscoveryOrientation(candidate?.orientation);

  const base = {
    viewerGender,
    viewerOrientation,
    candidateGender,
    candidateOrientation,
  };

  if (viewerGender === 'unknown' || viewerOrientation === 'unknown') {
    return {
      ...base,
      compatible: true,
      score: 0.35,
      reason: 'viewer_data_missing',
    };
  }

  if (candidateGender === 'unknown' || candidateOrientation === 'unknown') {
    return {
      ...base,
      compatible: true,
      score: 0.35,
      reason: 'candidate_data_missing',
    };
  }

  const viewerAcceptsCandidate = acceptsTarget(
    viewerGender,
    viewerOrientation,
    candidateGender
  );

  const candidateAcceptsViewer = acceptsTarget(
    candidateGender,
    candidateOrientation,
    viewerGender
  );

  if (viewerAcceptsCandidate === false && candidateAcceptsViewer === false) {
    return {
      ...base,
      compatible: false,
      score: 0,
      reason: 'mutual_mismatch',
    };
  }

  if (viewerAcceptsCandidate === false) {
    return {
      ...base,
      compatible: false,
      score: 0,
      reason: 'viewer_not_interested',
    };
  }

  if (candidateAcceptsViewer === false) {
    return {
      ...base,
      compatible: false,
      score: 0,
      reason: 'candidate_not_interested',
    };
  }

  return {
    ...base,
    compatible: true,
    score: 1,
    reason: 'mutual_match',
  };
}

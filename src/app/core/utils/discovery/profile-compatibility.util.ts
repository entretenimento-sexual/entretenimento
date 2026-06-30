// src/app/core/utils/discovery/profile-compatibility.util.ts
// -----------------------------------------------------------------------------
// ProfileCompatibilityUtils
// -----------------------------------------------------------------------------
// Regra pura de compatibilidade social para discovery.
// Não consulta Firestore, não conhece UI e não altera dados.
// -----------------------------------------------------------------------------

export type NormalizedDiscoveryGender =
  | 'man'
  | 'woman'
  | 'couple'
  | 'trans_woman'
  | 'trans_man'
  | 'travesti'
  | 'transgender'
  | 'crossdresser'
  | 'nonbinary'
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
  | 'mutual_mismatch'
  | 'explicit_preference_match'
  | 'inferred_orientation_match'
  | 'partial_match';

export interface ProfileCompatibilityLike {
  uid?: string | null;

  gender?: string | null;
  genero?: string | null;
  orientation?: string | null;
  sexualOrientation?: string | null;
  orientacao?: string | null;
  orientacaoSexual?: string | null;

  normalizedGender?: string | null;
  normalizedOrientation?: string | null;
  compatibilityReady?: boolean | null;

  partner1Orientation?: string | null;
  partner2Orientation?: string | null;

  preferences?: readonly string[] | string | null;
  preferencias?: readonly string[] | string | null;
  interestedInGenders?: readonly string[] | string | null;
  generosDeInteresse?: readonly string[] | string | null;
  interestedInOrientations?: readonly string[] | string | null;
  orientacoesDeInteresse?: readonly string[] | string | null;
}

export interface ProfileCompatibilityResult {
  readonly compatible: boolean;
  readonly score: number;
  readonly reason: ProfileCompatibilityReason;

  readonly viewerGender: NormalizedDiscoveryGender;
  readonly viewerOrientation: NormalizedDiscoveryOrientation;

  readonly candidateGender: NormalizedDiscoveryGender;
  readonly candidateOrientation: NormalizedDiscoveryOrientation;

  readonly viewerUsedExplicitPreference: boolean;
  readonly candidateUsedExplicitPreference: boolean;
}

interface NormalizedInterest {
  readonly genders: readonly NormalizedDiscoveryGender[] | null;
  readonly orientations: readonly NormalizedDiscoveryOrientation[] | null;
  readonly explicit: boolean;
}

const ALL_DISCOVERY_GENDERS: readonly NormalizedDiscoveryGender[] = [
  'man',
  'woman',
  'couple',
  'trans_woman',
  'trans_man',
  'travesti',
  'transgender',
  'crossdresser',
  'nonbinary',
];

const GENDER_DIVERSE_GENDERS: readonly NormalizedDiscoveryGender[] = [
  'trans_woman',
  'trans_man',
  'travesti',
  'transgender',
  'crossdresser',
  'nonbinary',
];

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    : '';
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}

function asArray(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    return [value];
  }

  return [];
}

function firstPresent(
  source: ProfileCompatibilityLike | null | undefined,
  keys: readonly (keyof ProfileCompatibilityLike)[]
): unknown {
  if (!source) {
    return null;
  }

  for (const key of keys) {
    const value = source[key];

    if (Array.isArray(value) && value.length > 0) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      return value;
    }

    if (value !== null && value !== undefined && typeof value !== 'string') {
      return value;
    }
  }

  return null;
}

function getGenderValue(profile: ProfileCompatibilityLike | null | undefined): unknown {
  return firstPresent(profile, ['normalizedGender', 'gender', 'genero']);
}

function getOrientationValue(profile: ProfileCompatibilityLike | null | undefined): unknown {
  return firstPresent(profile, [
    'normalizedOrientation',
    'orientation',
    'sexualOrientation',
    'orientacao',
    'orientacaoSexual',
  ]);
}

function getPreferenceValue(profile: ProfileCompatibilityLike | null | undefined): unknown {
  return firstPresent(profile, ['preferences', 'preferencias']);
}

function getInterestedGenderValue(profile: ProfileCompatibilityLike | null | undefined): unknown {
  return firstPresent(profile, ['interestedInGenders', 'generosDeInteresse']);
}

function getInterestedOrientationValue(profile: ProfileCompatibilityLike | null | undefined): unknown {
  return firstPresent(profile, ['interestedInOrientations', 'orientacoesDeInteresse']);
}

function isGenderDiverseGender(value: NormalizedDiscoveryGender): boolean {
  return GENDER_DIVERSE_GENDERS.includes(value);
}

export function normalizeDiscoveryGender(value: unknown): NormalizedDiscoveryGender {
  const text = normalizeText(value).replace(/_/g, '-');

  if (text === 'travesti' || text === 'travestis') {
    return 'travesti';
  }

  if (
    text === 'mulher-trans' ||
    text === 'mulher trans' ||
    text === 'mulheres-trans' ||
    text === 'mulheres trans' ||
    text === 'mulher-transexual' ||
    text === 'mulher transexual' ||
    text === 'trans-woman' ||
    text === 'trans woman' ||
    text === 'transfeminina' ||
    text === 'trans feminina'
  ) {
    return 'trans_woman';
  }

  if (
    text === 'homem-trans' ||
    text === 'homem trans' ||
    text === 'homens-trans' ||
    text === 'homens trans' ||
    text === 'homem-transexual' ||
    text === 'homem transexual' ||
    text === 'trans-man' ||
    text === 'trans man' ||
    text === 'transmasculino' ||
    text === 'trans masculino'
  ) {
    return 'trans_man';
  }

  if (
    text === 'crossdresser' ||
    text === 'crossdressers' ||
    text === 'cross-dresser' ||
    text === 'cross-dressers' ||
    text === 'cd'
  ) {
    return 'crossdresser';
  }

  if (
    text === 'nao-binario' ||
    text === 'nao binario' ||
    text === 'nonbinary' ||
    text === 'non-binary' ||
    text === 'non binary' ||
    text === 'genero-fluido' ||
    text === 'genero fluido' ||
    text === 'genderfluid'
  ) {
    return 'nonbinary';
  }

  if (
    text === 'transgenero' ||
    text === 'transgender' ||
    text === 'trans' ||
    text === 'transexual' ||
    text === 'transexuais' ||
    text === 'transsexual' ||
    text === 'transsexuais'
  ) {
    return 'transgender';
  }

  if (
    text === 'homem' ||
    text === 'homens' ||
    text === 'masculino' ||
    text === 'male' ||
    text === 'man' ||
    text === 'men'
  ) {
    return 'man';
  }

  if (
    text === 'mulher' ||
    text === 'mulheres' ||
    text === 'feminino' ||
    text === 'female' ||
    text === 'woman' ||
    text === 'women'
  ) {
    return 'woman';
  }

  if (
    text === 'casal' ||
    text === 'casais' ||
    text === 'couple' ||
    text === 'couples' ||
    text === 'dupla' ||
    text === 'casal-ele-ele' ||
    text === 'casal-ele-ela' ||
    text === 'casal-ela-ela'
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
    text === 'hetero' ||
    text === 'heteros' ||
    text === 'straight'
  ) {
    return 'heterosexual';
  }

  if (
    text === 'homossexual' ||
    text === 'homosexual' ||
    text === 'homo' ||
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

  if (text === 'pansexual' || text === 'pan') {
    return 'pansexual';
  }

  return 'unknown';
}

function gendersFromFreeText(value: unknown): NormalizedDiscoveryGender[] {
  const text = normalizeText(value).replace(/_/g, '-');
  const genders: NormalizedDiscoveryGender[] = [];
  const mentionsDiverseGender = /\b(trans|transgenero|transgender|transexual|transsexual|travesti|crossdresser|cross-dresser|nao-binario|nonbinary|non-binary|genderfluid)\b/.test(text);

  if (/\btravesti\b/.test(text) || /\btravestis\b/.test(text)) {
    genders.push('travesti');
  }

  if (/\bmulher(?:es)?[-\s]+trans\b/.test(text) || /\bmulher(?:es)?[-\s]+transexual\b/.test(text) || /\btrans[-\s]+woman\b/.test(text) || /\btransfeminina\b/.test(text)) {
    genders.push('trans_woman');
  }

  if (/\bhomem(?:s)?[-\s]+trans\b/.test(text) || /\bhomem(?:s)?[-\s]+transexual\b/.test(text) || /\btrans[-\s]+man\b/.test(text) || /\btransmasculino\b/.test(text)) {
    genders.push('trans_man');
  }

  if (/\bcrossdresser\b/.test(text) || /\bcross-dresser\b/.test(text) || /\bcd\b/.test(text)) {
    genders.push('crossdresser');
  }

  if (/\bnao-binario\b/.test(text) || /\bnao binario\b/.test(text) || /\bnonbinary\b/.test(text) || /\bnon-binary\b/.test(text) || /\bgenderfluid\b/.test(text)) {
    genders.push('nonbinary');
  }

  if (/\btransgenero\b/.test(text) || /\btransgender\b/.test(text) || /\btransexual\b/.test(text) || /\btranssexual\b/.test(text) || text === 'trans') {
    genders.push('transgender');
  }

  if (!mentionsDiverseGender && (/\bhomem\b/.test(text) || /\bhomens\b/.test(text) || /\bmasculino\b/.test(text) || /\bmale\b/.test(text) || /\bmen\b/.test(text))) {
    genders.push('man');
  }

  if (!mentionsDiverseGender && (/\bmulher\b/.test(text) || /\bmulheres\b/.test(text) || /\bfeminino\b/.test(text) || /\bfemale\b/.test(text) || /\bwomen\b/.test(text))) {
    genders.push('woman');
  }

  if (/\bcasal\b/.test(text) || /\bcasais\b/.test(text) || /\bcouple\b/.test(text) || /\bcouples\b/.test(text) || /\bdupla\b/.test(text) || /\bcasal-ele-ele\b/.test(text) || /\bcasal-ele-ela\b/.test(text) || /\bcasal-ela-ela\b/.test(text)) {
    genders.push('couple');
  }

  return genders;
}

function orientationsFromFreeText(value: unknown): NormalizedDiscoveryOrientation[] {
  const text = normalizeText(value);
  const orientations: NormalizedDiscoveryOrientation[] = [];

  if (/\bhetero\b/.test(text) || /\bheteros\b/.test(text) || /\bheterossexual\b/.test(text) || /\bheterosexual\b/.test(text) || /\bstraight\b/.test(text)) {
    orientations.push('heterosexual');
  }

  if (/\bhomo\b/.test(text) || /\bhomossexual\b/.test(text) || /\bhomosexual\b/.test(text) || /\bgay\b/.test(text) || /\blesbica\b/.test(text) || /\blesbian\b/.test(text)) {
    orientations.push('homosexual');
  }

  if (/\bbi\b/.test(text) || /\bbissexual\b/.test(text) || /\bbisexual\b/.test(text)) {
    orientations.push('bisexual');
  }

  if (/\bpan\b/.test(text) || /\bpansexual\b/.test(text)) {
    orientations.push('pansexual');
  }

  return orientations;
}

function normalizeGenderList(values: unknown): readonly NormalizedDiscoveryGender[] {
  return unique(
    asArray(values)
      .flatMap((value) => {
        const direct = normalizeDiscoveryGender(value);

        if (direct !== 'unknown') {
          return [direct];
        }

        return gendersFromFreeText(value);
      })
      .filter((value): value is NormalizedDiscoveryGender => value !== 'unknown')
  );
}

function normalizeOrientationList(
  values: unknown
): readonly NormalizedDiscoveryOrientation[] {
  return unique(
    asArray(values)
      .flatMap((value) => {
        const direct = normalizeDiscoveryOrientation(value);

        if (direct !== 'unknown') {
          return [direct];
        }

        return orientationsFromFreeText(value);
      })
      .filter((value): value is NormalizedDiscoveryOrientation => value !== 'unknown')
  );
}

function acceptedTargetGendersByOrientation(
  selfGender: NormalizedDiscoveryGender,
  selfOrientation: NormalizedDiscoveryOrientation
): readonly NormalizedDiscoveryGender[] | null {
  if (selfGender === 'unknown' || selfOrientation === 'unknown') {
    return null;
  }

  if (selfOrientation === 'bisexual' || selfOrientation === 'pansexual') {
    return ALL_DISCOVERY_GENDERS;
  }

  if (selfGender === 'man' || selfGender === 'trans_man') {
    if (selfOrientation === 'heterosexual') {
      return ['woman', 'trans_woman', 'travesti'];
    }

    if (selfOrientation === 'homosexual') {
      return ['man', 'trans_man'];
    }
  }

  if (selfGender === 'woman' || selfGender === 'trans_woman' || selfGender === 'travesti') {
    if (selfOrientation === 'heterosexual') {
      return ['man', 'trans_man'];
    }

    if (selfOrientation === 'homosexual') {
      return ['woman', 'trans_woman', 'travesti'];
    }
  }

  if (selfGender === 'couple' || selfGender === 'transgender' || selfGender === 'crossdresser' || selfGender === 'nonbinary') {
    return ALL_DISCOVERY_GENDERS;
  }

  return null;
}

function acceptedTargetOrientationsByOrientation(
  selfOrientation: NormalizedDiscoveryOrientation
): readonly NormalizedDiscoveryOrientation[] | null {
  if (selfOrientation === 'homosexual') {
    return ['homosexual', 'bisexual', 'pansexual'];
  }

  if (selfOrientation === 'heterosexual') {
    return ['heterosexual', 'bisexual', 'pansexual'];
  }

  if (selfOrientation === 'bisexual' || selfOrientation === 'pansexual') {
    return ['heterosexual', 'homosexual', 'bisexual', 'pansexual'];
  }

  return null;
}

function resolveInterest(
  profile: ProfileCompatibilityLike | null | undefined
): NormalizedInterest {
  const explicitGenders = normalizeGenderList(getInterestedGenderValue(profile));
  const explicitOrientations = normalizeOrientationList(getInterestedOrientationValue(profile));

  const preferences = getPreferenceValue(profile);
  const preferenceGenders = normalizeGenderList(preferences);
  const preferenceOrientations = normalizeOrientationList(preferences);

  const selfGender = normalizeDiscoveryGender(getGenderValue(profile));
  const selfOrientation = normalizeDiscoveryOrientation(getOrientationValue(profile));
  const fallbackGenders = acceptedTargetGendersByOrientation(selfGender, selfOrientation);
  const fallbackOrientations = acceptedTargetOrientationsByOrientation(selfOrientation);

  const genders = explicitGenders.length
    ? explicitGenders
    : preferenceGenders.length
      ? preferenceGenders
      : fallbackGenders;

  const orientations = explicitOrientations.length
    ? explicitOrientations
    : preferenceOrientations.length
      ? preferenceOrientations
      : fallbackOrientations;

  if (genders || orientations) {
    return {
      genders,
      orientations,
      explicit: explicitGenders.length > 0 ||
        explicitOrientations.length > 0 ||
        preferenceGenders.length > 0 ||
        preferenceOrientations.length > 0,
    };
  }

  return {
    genders: fallbackGenders,
    orientations: fallbackOrientations,
    explicit: false,
  };
}

function genderAccepted(
  interest: NormalizedInterest,
  targetGender: NormalizedDiscoveryGender
): boolean | null {
  if (targetGender === 'unknown') {
    return null;
  }

  if (!interest.genders?.length) {
    return null;
  }

  if (interest.genders.includes(targetGender)) {
    return true;
  }

  if (isGenderDiverseGender(targetGender) && !interest.explicit) {
    return null;
  }

  return false;
}

function orientationAccepted(
  interest: NormalizedInterest,
  targetOrientation: NormalizedDiscoveryOrientation
): boolean | null {
  if (targetOrientation === 'unknown') {
    return null;
  }

  if (!interest.orientations?.length) {
    return null;
  }

  return interest.orientations.includes(targetOrientation);
}

function acceptsTarget(
  interest: NormalizedInterest,
  targetGender: NormalizedDiscoveryGender,
  targetOrientation: NormalizedDiscoveryOrientation
): boolean | null {
  const acceptsGender = genderAccepted(interest, targetGender);
  const acceptsOrientation = orientationAccepted(interest, targetOrientation);

  if (acceptsGender === false || acceptsOrientation === false) {
    return false;
  }

  if (acceptsGender === true || acceptsOrientation === true) {
    return true;
  }

  return null;
}

function scoreFromMatch(input: {
  viewerAcceptsCandidate: boolean | null;
  candidateAcceptsViewer: boolean | null;
  viewerExplicit: boolean;
  candidateExplicit: boolean;
}): number {
  const viewerScore =
    input.viewerAcceptsCandidate === true
      ? input.viewerExplicit
        ? 0.62
        : 0.5
      : input.viewerAcceptsCandidate === null
        ? 0.22
        : 0;

  const candidateScore =
    input.candidateAcceptsViewer === true
      ? input.candidateExplicit
        ? 0.38
        : 0.3
      : input.candidateAcceptsViewer === null
        ? 0.18
        : 0;

  return Math.max(0, Math.min(1, viewerScore + candidateScore));
}

export function evaluateProfileCompatibility(
  viewer: ProfileCompatibilityLike | null | undefined,
  candidate: ProfileCompatibilityLike | null | undefined
): ProfileCompatibilityResult {
  const viewerGender = normalizeDiscoveryGender(getGenderValue(viewer));
  const viewerOrientation = normalizeDiscoveryOrientation(getOrientationValue(viewer));

  const candidateGender = normalizeDiscoveryGender(getGenderValue(candidate));
  const candidateOrientation = normalizeDiscoveryOrientation(getOrientationValue(candidate));

  const viewerInterest = resolveInterest(viewer);
  const candidateInterest = resolveInterest(candidate);

  const base = {
    viewerGender,
    viewerOrientation,
    candidateGender,
    candidateOrientation,
    viewerUsedExplicitPreference: viewerInterest.explicit,
    candidateUsedExplicitPreference: candidateInterest.explicit,
  };

  if (viewerGender === 'unknown' || viewerOrientation === 'unknown') {
    return {
      ...base,
      compatible: true,
      score: 0.28,
      reason: 'viewer_data_missing',
    };
  }

  const viewerAcceptsCandidate = acceptsTarget(
    viewerInterest,
    candidateGender,
    candidateOrientation
  );

  const candidateAcceptsViewer = acceptsTarget(
    candidateInterest,
    viewerGender,
    viewerOrientation
  );

  if (candidateGender === 'unknown' || candidateOrientation === 'unknown') {
    if (viewerAcceptsCandidate === false) {
      return {
        ...base,
        compatible: false,
        score: 0,
        reason: 'viewer_not_interested',
      };
    }

    return {
      ...base,
      compatible: true,
      score: 0.3,
      reason: 'candidate_data_missing',
    };
  }

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

  const score = scoreFromMatch({
    viewerAcceptsCandidate,
    candidateAcceptsViewer,
    viewerExplicit: viewerInterest.explicit,
    candidateExplicit: candidateInterest.explicit,
  });

  if (viewerInterest.explicit && viewerAcceptsCandidate === true) {
    return {
      ...base,
      compatible: true,
      score,
      reason: 'explicit_preference_match',
    };
  }

  if (viewerAcceptsCandidate === true && candidateAcceptsViewer === true) {
    return {
      ...base,
      compatible: true,
      score,
      reason: 'mutual_match',
    };
  }

  if (viewerAcceptsCandidate === true || candidateAcceptsViewer === true) {
    return {
      ...base,
      compatible: true,
      score,
      reason: 'partial_match',
    };
  }

  return {
    ...base,
    compatible: true,
    score: Math.max(score, 0.32),
    reason: 'inferred_orientation_match',
  };
}

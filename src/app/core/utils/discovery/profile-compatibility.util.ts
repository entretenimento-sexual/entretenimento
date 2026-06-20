// src/app/core/utils/discovery/profile-compatibility.util.ts
// -----------------------------------------------------------------------------
// ProfileCompatibilityUtils
// -----------------------------------------------------------------------------
// Regra pura de compatibilidade social/sexual para discovery.
// Não consulta Firestore, não conhece UI e não altera dados.
//
// Estratégia:
// 1. Preferência explícita de gênero, quando existir, tem prioridade.
// 2. Preferência explícita só de orientação não anula o gênero esperado pela
//    orientação da própria pessoa.
// 3. Gênero/orientação declarados entram como fallback.
// 4. Compatibilidade exige interesse mínimo do viewer.
// 5. Reciprocidade do candidato é aplicada por preferência explícita futura
//    ou por fallback de orientação.
// 6. Dados incompletos não viram bloqueio absoluto; viram score menor, exceto
//    quando o gênero conhecido já é incompatível com o viewer.

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
  | 'mutual_mismatch'
  | 'explicit_preference_match'
  | 'inferred_orientation_match'
  | 'partial_match';

export interface ProfileCompatibilityLike {
  uid?: string | null;

  gender?: string | null;
  orientation?: string | null;

  partner1Orientation?: string | null;
  partner2Orientation?: string | null;

  /**
   * Campo já existente no usuário.
   * Pode conter tokens livres vindos do formulário atual.
   * Ex.: "homens", "mulheres", "casais", "homens heteros", "bi", etc.
   */
  preferences?: readonly string[] | null;

  /**
   * Campos preparados para evolução futura.
   * Quando forem persistidos/publicados, serão usados antes do fallback.
   */
  interestedInGenders?: readonly string[] | null;
  interestedInOrientations?: readonly string[] | null;
}

export interface ProfileCompatibilityResult {
  readonly compatible: boolean;
  readonly score: number; // 0..1
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

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    : '';
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeDiscoveryGender(value: unknown): NormalizedDiscoveryGender {
  const text = normalizeText(value).replace(/_/g, '-');

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

  if (
    text === 'travesti' ||
    text === 'travestis' ||
    text === 'transexual' ||
    text === 'transexuais' ||
    text === 'transsexual' ||
    text === 'transgender' ||
    text === 'crossdresser' ||
    text === 'crossdressers'
  ) {
    return 'unknown';
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

  if (
    text === 'pansexual' ||
    text === 'pan'
  ) {
    return 'pansexual';
  }

  return 'unknown';
}

function gendersFromFreeText(value: unknown): NormalizedDiscoveryGender[] {
  const text = normalizeText(value).replace(/_/g, '-');
  const genders: NormalizedDiscoveryGender[] = [];

  if (
    /\bhomem\b/.test(text) ||
    /\bhomens\b/.test(text) ||
    /\bmasculino\b/.test(text) ||
    /\bmale\b/.test(text) ||
    /\bmen\b/.test(text)
  ) {
    genders.push('man');
  }

  if (
    /\bmulher\b/.test(text) ||
    /\bmulheres\b/.test(text) ||
    /\bfeminino\b/.test(text) ||
    /\bfemale\b/.test(text) ||
    /\bwomen\b/.test(text)
  ) {
    genders.push('woman');
  }

  if (
    /\bcasal\b/.test(text) ||
    /\bcasais\b/.test(text) ||
    /\bcouple\b/.test(text) ||
    /\bcouples\b/.test(text) ||
    /\bdupla\b/.test(text) ||
    /\bcasal-ele-ele\b/.test(text) ||
    /\bcasal-ele-ela\b/.test(text) ||
    /\bcasal-ela-ela\b/.test(text)
  ) {
    genders.push('couple');
  }

  return genders;
}

function orientationsFromFreeText(value: unknown): NormalizedDiscoveryOrientation[] {
  const text = normalizeText(value);
  const orientations: NormalizedDiscoveryOrientation[] = [];

  if (
    /\bhetero\b/.test(text) ||
    /\bheteros\b/.test(text) ||
    /\bheterossexual\b/.test(text) ||
    /\bheterosexual\b/.test(text) ||
    /\bstraight\b/.test(text)
  ) {
    orientations.push('heterosexual');
  }

  if (
    /\bhomo\b/.test(text) ||
    /\bhomossexual\b/.test(text) ||
    /\bhomosexual\b/.test(text) ||
    /\bgay\b/.test(text) ||
    /\blesbica\b/.test(text) ||
    /\blesbian\b/.test(text)
  ) {
    orientations.push('homosexual');
  }

  if (
    /\bbi\b/.test(text) ||
    /\bbissexual\b/.test(text) ||
    /\bbisexual\b/.test(text)
  ) {
    orientations.push('bisexual');
  }

  if (
    /\bpan\b/.test(text) ||
    /\bpansexual\b/.test(text)
  ) {
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

function resolveInterest(profile: ProfileCompatibilityLike | null | undefined): NormalizedInterest {
  const explicitGenders = normalizeGenderList(profile?.interestedInGenders);
  const explicitOrientations = normalizeOrientationList(profile?.interestedInOrientations);

  const preferenceGenders = normalizeGenderList(profile?.preferences);
  const preferenceOrientations = normalizeOrientationList(profile?.preferences);

  const selfGender = normalizeDiscoveryGender(profile?.gender);
  const selfOrientation = normalizeDiscoveryOrientation(profile?.orientation);
  const fallbackGenders = acceptedTargetGendersByOrientation(selfGender, selfOrientation);

  const genders = explicitGenders.length
    ? explicitGenders
    : preferenceGenders.length
      ? preferenceGenders
      : fallbackGenders;

  const orientations = explicitOrientations.length
    ? explicitOrientations
    : preferenceOrientations.length
      ? preferenceOrientations
      : null;

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
    orientations: null,
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

  return interest.genders.includes(targetGender);
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
  const viewerGender = normalizeDiscoveryGender(viewer?.gender);
  const viewerOrientation = normalizeDiscoveryOrientation(viewer?.orientation);

  const candidateGender = normalizeDiscoveryGender(candidate?.gender);
  const candidateOrientation = normalizeDiscoveryOrientation(candidate?.orientation);

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

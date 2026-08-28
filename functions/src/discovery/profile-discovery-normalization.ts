// functions/src/discovery/profile-discovery-normalization.ts
// -----------------------------------------------------------------------------
// PROFILE DISCOVERY NORMALIZATION
// -----------------------------------------------------------------------------
// Normalização canônica de gênero/orientação/interesses para descoberta.
// Esta camada roda no backend e deve ser a fonte confiável para futuros índices.
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

export interface CanonicalProfileDiscoveryFields {
  normalizedGender: NormalizedDiscoveryGender;
  normalizedOrientation: NormalizedDiscoveryOrientation;
  interestedInGenders: readonly NormalizedDiscoveryGender[];
  interestedInOrientations: readonly NormalizedDiscoveryOrientation[];
  compatibilityReady: boolean;
}

interface ProfileDiscoverySource {
  gender?: unknown;
  genero?: unknown;
  orientation?: unknown;
  sexualOrientation?: unknown;
  orientacao?: unknown;
  orientacaoSexual?: unknown;
  preferences?: unknown;
  preferencias?: unknown;
  interestedInGenders?: unknown;
  generosDeInteresse?: unknown;
  interestedInOrientations?: unknown;
  orientacoesDeInteresse?: unknown;
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

const DIVERSE_GENDER_PATTERNS: readonly RegExp[] = [
  /\btrans\b/,
  /\btransgenero\b/,
  /\btransgender\b/,
  /\btransexual\b/,
  /\btranssexual\b/,
  /\btravestis?\b/,
  /\bcrossdresser\b/,
  /\bcross-dresser\b/,
  /\bnao-binario\b/,
  /\bnonbinary\b/,
  /\bnon-binary\b/,
  /\bgenderfluid\b/,
];

const TRANS_WOMAN_PATTERNS: readonly RegExp[] = [
  /\bmulher(?:es)?[-\s]+trans\b/,
  /\bmulher(?:es)?[-\s]+transexual\b/,
  /\btrans[-\s]+woman\b/,
  /\btransfeminina\b/,
];

const TRANS_MAN_PATTERNS: readonly RegExp[] = [
  /\bhomem(?:s)?[-\s]+trans\b/,
  /\bhomem(?:s)?[-\s]+transexual\b/,
  /\btrans[-\s]+man\b/,
  /\btransmasculino\b/,
];

const NONBINARY_PATTERNS: readonly RegExp[] = [
  /\bnao-binario\b/,
  /\bnao binario\b/,
  /\bnonbinary\b/,
  /\bnon-binary\b/,
  /\bgenderfluid\b/,
];

const MAN_PATTERNS: readonly RegExp[] = [
  /\bhomem\b/,
  /\bhomens\b/,
  /\bmasculino\b/,
  /\bmale\b/,
  /\bmen\b/,
];

const WOMAN_PATTERNS: readonly RegExp[] = [
  /\bmulher\b/,
  /\bmulheres\b/,
  /\bfeminino\b/,
  /\bfemale\b/,
  /\bwomen\b/,
];

const COUPLE_PATTERNS: readonly RegExp[] = [
  /\bcasal\b/,
  /\bcasais\b/,
  /\bcouple\b/,
  /\bcouples\b/,
  /\bdupla\b/,
  /\bcasal-ele-ele\b/,
  /\bcasal-ele-ela\b/,
  /\bcasal-ela-ela\b/,
];

const HETEROSEXUAL_PATTERNS: readonly RegExp[] = [
  /\bhetero\b/,
  /\bheteros\b/,
  /\bheterossexual\b/,
  /\bheterosexual\b/,
  /\bstraight\b/,
];

const HOMOSEXUAL_PATTERNS: readonly RegExp[] = [
  /\bhomo\b/,
  /\bhomossexual\b/,
  /\bhomosexual\b/,
  /\bgay\b/,
  /\blesbica\b/,
  /\blesbian\b/,
];

const BISEXUAL_PATTERNS: readonly RegExp[] = [
  /\bbi\b/,
  /\bbissexual\b/,
  /\bbisexual\b/,
];

const PANSEXUAL_PATTERNS: readonly RegExp[] = [
  /\bpan\b/,
  /\bpansexual\b/,
];

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
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

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
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
  const mentionsDiverseGender = matchesAny(text, DIVERSE_GENDER_PATTERNS);

  if (/\btravestis?\b/.test(text)) {
    genders.push('travesti');
  }

  if (matchesAny(text, TRANS_WOMAN_PATTERNS)) {
    genders.push('trans_woman');
  }

  if (matchesAny(text, TRANS_MAN_PATTERNS)) {
    genders.push('trans_man');
  }

  if (
    /\bcrossdresser\b/.test(text) ||
    /\bcross-dresser\b/.test(text) ||
    /\bcd\b/.test(text)
  ) {
    genders.push('crossdresser');
  }

  if (matchesAny(text, NONBINARY_PATTERNS)) {
    genders.push('nonbinary');
  }

  if (
    /\btransgenero\b/.test(text) ||
    /\btransgender\b/.test(text) ||
    /\btransexual\b/.test(text) ||
    /\btranssexual\b/.test(text) ||
    text === 'trans'
  ) {
    genders.push('transgender');
  }

  if (!mentionsDiverseGender && matchesAny(text, MAN_PATTERNS)) {
    genders.push('man');
  }

  if (!mentionsDiverseGender && matchesAny(text, WOMAN_PATTERNS)) {
    genders.push('woman');
  }

  if (matchesAny(text, COUPLE_PATTERNS)) {
    genders.push('couple');
  }

  return genders;
}

function orientationsFromFreeText(value: unknown): NormalizedDiscoveryOrientation[] {
  const text = normalizeText(value);
  const orientations: NormalizedDiscoveryOrientation[] = [];

  if (matchesAny(text, HETEROSEXUAL_PATTERNS)) {
    orientations.push('heterosexual');
  }

  if (matchesAny(text, HOMOSEXUAL_PATTERNS)) {
    orientations.push('homosexual');
  }

  if (matchesAny(text, BISEXUAL_PATTERNS)) {
    orientations.push('bisexual');
  }

  if (matchesAny(text, PANSEXUAL_PATTERNS)) {
    orientations.push('pansexual');
  }

  return orientations;
}

function normalizeGenderList(values: unknown): readonly NormalizedDiscoveryGender[] {
  return unique(
    asArray(values)
      .flatMap((value) => {
        const direct = normalizeDiscoveryGender(value);

        return direct !== 'unknown' ? [direct] : gendersFromFreeText(value);
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

        return direct !== 'unknown' ? [direct] : orientationsFromFreeText(value);
      })
      .filter((value): value is NormalizedDiscoveryOrientation => value !== 'unknown')
  );
}

function acceptedTargetGendersByOrientation(
  selfGender: NormalizedDiscoveryGender,
  selfOrientation: NormalizedDiscoveryOrientation
): readonly NormalizedDiscoveryGender[] {
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

  if (
    selfGender === 'woman' ||
    selfGender === 'trans_woman' ||
    selfGender === 'travesti'
  ) {
    if (selfOrientation === 'heterosexual') {
      return ['man', 'trans_man'];
    }

    if (selfOrientation === 'homosexual') {
      return ['woman', 'trans_woman', 'travesti'];
    }
  }

  if (
    selfGender === 'couple' ||
    selfGender === 'transgender' ||
    selfGender === 'crossdresser' ||
    selfGender === 'nonbinary'
  ) {
    return ALL_DISCOVERY_GENDERS;
  }

  return [];
}

function acceptedTargetOrientationsByOrientation(
  selfOrientation: NormalizedDiscoveryOrientation
): readonly NormalizedDiscoveryOrientation[] {
  if (selfOrientation === 'homosexual') {
    return ['homosexual', 'bisexual', 'pansexual'];
  }

  if (selfOrientation === 'heterosexual') {
    return ['heterosexual', 'bisexual', 'pansexual'];
  }

  if (selfOrientation === 'bisexual' || selfOrientation === 'pansexual') {
    return ['heterosexual', 'homosexual', 'bisexual', 'pansexual'];
  }

  return [];
}

export function normalizeProfileDiscoveryFields(
  source: ProfileDiscoverySource | null | undefined
): CanonicalProfileDiscoveryFields {
  const normalizedGender = normalizeDiscoveryGender(source?.gender ?? source?.genero);
  const normalizedOrientation = normalizeDiscoveryOrientation(
    source?.orientation ??
      source?.sexualOrientation ??
      source?.orientacao ??
      source?.orientacaoSexual
  );

  const explicitGenders = normalizeGenderList(
    source?.interestedInGenders ?? source?.generosDeInteresse
  );
  const preferenceGenders = normalizeGenderList(source?.preferences ?? source?.preferencias);
  const fallbackGenders = acceptedTargetGendersByOrientation(
    normalizedGender,
    normalizedOrientation
  );

  const explicitOrientations = normalizeOrientationList(
    source?.interestedInOrientations ?? source?.orientacoesDeInteresse
  );
  const preferenceOrientations = normalizeOrientationList(
    source?.preferences ?? source?.preferencias
  );
  const fallbackOrientations = acceptedTargetOrientationsByOrientation(normalizedOrientation);

  const interestedInGenders = explicitGenders.length
    ? explicitGenders
    : preferenceGenders.length
      ? preferenceGenders
      : fallbackGenders;

  const interestedInOrientations = explicitOrientations.length
    ? explicitOrientations
    : preferenceOrientations.length
      ? preferenceOrientations
      : fallbackOrientations;

  return {
    normalizedGender,
    normalizedOrientation,
    interestedInGenders,
    interestedInOrientations,
    compatibilityReady:
      normalizedGender !== 'unknown' &&
      normalizedOrientation !== 'unknown' &&
      interestedInGenders.length > 0,
  };
}

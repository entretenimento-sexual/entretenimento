// src/app/core/utils/discovery/profile-type-preference-filter.util.ts
// -----------------------------------------------------------------------------
// POLÍTICA PURA DE PREFERÊNCIAS DO DISCOVERY
// -----------------------------------------------------------------------------
// - filtros essenciais são controlados pelo usuário e nunca ampliados em silêncio;
// - "preferir" produz afinidade para ranking;
// - "exigir" elimina candidatos incompatíveis;
// - preferências avançadas exigem Básico para ranking e Premium para filtro rígido;
// - nenhuma consulta Firestore ou dado pessoal é emitido em log.
// -----------------------------------------------------------------------------

import type { IUserDados } from '../../interfaces/iuser-dados';
import type {
  IUserDiscoveryPreferences,
  UserDiscoveryGenderInterest,
} from '../../interfaces/preferences/user-discovery-preferences.interface';
import {
  evaluatePlatformSubscriptionProjection,
  hasMinimumPlatformSubscriptionRole,
} from '../../services/subscriptions/platform-subscription-access.model';
import {
  evaluateProfileCompatibility,
  normalizeDiscoveryCoupleVariant,
  normalizeDiscoveryGender,
} from './profile-compatibility.util';
import type { NormalizedDiscoveryGender } from './profile-compatibility.util';

export type DiscoveryPreferenceRejectionReason =
  | 'couples_disabled'
  | 'singles_disabled'
  | 'trans_profiles_disabled'
  | 'profile_type_not_selected'
  | 'age_missing'
  | 'age_out_of_range'
  | 'location_required'
  | 'outside_max_distance'
  | 'relationship_intent_missing'
  | 'relationship_intent_mismatch'
  | 'sexual_practice_missing'
  | 'sexual_practice_mismatch'
  | 'body_trait_missing'
  | 'body_trait_mismatch'
  | 'reciprocal_mismatch';

export type DiscoveryPreferenceMatchSignal =
  | 'relationship_intent'
  | 'sexual_practice'
  | 'body_trait';

export interface DiscoveryPreferenceFilterResult {
  accepted: boolean;
  reason: DiscoveryPreferenceRejectionReason | null;
  /** 0..1. Neutro em 0.5 quando não há preferência flexível avaliável. */
  preferenceScore: number;
  matchedSignals: readonly DiscoveryPreferenceMatchSignal[];
}

const NEUTRAL_SCORE = 0.5;
const TRANS_GENDERS = new Set<NormalizedDiscoveryGender>([
  'trans_woman',
  'trans_man',
  'travesti',
  'transgender',
]);

export function filterDiscoveryCandidatesByViewerPreferences(
  candidates: readonly IUserDados[],
  viewer: IUserDados | null | undefined
): IUserDados[] {
  return (candidates ?? []).filter(
    (candidate) => evaluateDiscoveryCandidatePreference(viewer, candidate).accepted
  );
}

export function evaluateDiscoveryCandidatePreference(
  viewer: IUserDados | null | undefined,
  candidate: IUserDados | null | undefined
): DiscoveryPreferenceFilterResult {
  if (!viewer?.uid || !candidate?.uid) return acceptedResult();

  const preferences = normalizePreferences(viewer.discoveryPreferences);
  if (!preferences) return evaluateReciprocity(viewer, candidate, acceptedResult());

  const candidateGender = resolveCandidateGender(candidate);
  const isCouple = candidateGender === 'couple';

  if (isCouple && !preferences.acceptsCouples) return rejected('couples_disabled');
  if (!isCouple && !preferences.acceptsSingles) return rejected('singles_disabled');

  if (
    preferences.acceptsTransProfiles === false &&
    isTransProfile(candidate, candidateGender)
  ) return rejected('trans_profiles_disabled');

  if (
    preferences.genderInterests.length > 0 &&
    !preferences.genderInterests.some((interest) =>
      candidateMatchesInterest(candidate, candidateGender, interest)
    )
  ) return rejected('profile_type_not_selected');

  const ageResult = evaluateAge(preferences, candidate);
  if (ageResult) return rejected(ageResult);

  const distanceResult = evaluateDistance(preferences, candidate);
  if (distanceResult) return rejected(distanceResult);

  const subscription = resolveAdvancedAccess(viewer);
  const flexibleScores: number[] = [];
  const matchedSignals: DiscoveryPreferenceMatchSignal[] = [];

  const relationship = evaluateListPreference(
    preferences.relationshipIntents,
    candidate.publicRelationshipIntents,
    preferences.relationshipIntentMode,
    'relationship_intent_missing',
    'relationship_intent_mismatch'
  );
  if (relationship.rejection) return rejected(relationship.rejection);
  if (relationship.active) {
    flexibleScores.push(relationship.score);
    if (relationship.score > 0) matchedSignals.push('relationship_intent');
  }

  if (subscription.basic) {
    const practiceMode = preferences.sexualPracticeMode === 'require' && subscription.premium
      ? 'require'
      : 'prefer';
    const practices = evaluateListPreference(
      preferences.sexualPractices,
      candidate.publicSexualPractices,
      practiceMode,
      'sexual_practice_missing',
      'sexual_practice_mismatch'
    );
    if (practices.rejection) return rejected(practices.rejection);
    if (practices.active) {
      flexibleScores.push(practices.score);
      if (practices.score > 0) matchedSignals.push('sexual_practice');
    }

    const bodyMode = preferences.bodyPreferenceMode === 'require' && subscription.premium
      ? 'require'
      : 'prefer';
    const body = evaluateListPreference(
      preferences.bodyPreferences,
      candidate.publicBodyTraits,
      bodyMode,
      'body_trait_missing',
      'body_trait_mismatch'
    );
    if (body.rejection) return rejected(body.rejection);
    if (body.active) {
      flexibleScores.push(body.score);
      if (body.score > 0) matchedSignals.push('body_trait');
    }
  }

  const reciprocal = evaluateReciprocity(
    viewer,
    candidate,
    acceptedResult(averageOrNeutral(flexibleScores), matchedSignals)
  );
  return reciprocal;
}

function evaluateAge(
  preferences: IUserDiscoveryPreferences,
  candidate: IUserDados
): DiscoveryPreferenceRejectionReason | null {
  if (!preferences.ageRange) return null;
  const age = finiteNumber(candidate.age ?? candidate.idade);
  if (age === null) return 'age_missing';
  return age < preferences.ageRange.min || age > preferences.ageRange.max
    ? 'age_out_of_range'
    : null;
}

function evaluateDistance(
  preferences: IUserDiscoveryPreferences,
  candidate: IUserDados
): DiscoveryPreferenceRejectionReason | null {
  if (preferences.maxDistanceKm === null) return null;
  const distance = finiteNumber(candidate.distanciaKm);
  if (distance === null) return preferences.locationRequired ? 'location_required' : null;
  return distance > preferences.maxDistanceKm ? 'outside_max_distance' : null;
}

function evaluateListPreference(
  selected: readonly string[],
  candidateValues: readonly string[] | null | undefined,
  mode: 'prefer' | 'require',
  missingReason: DiscoveryPreferenceRejectionReason,
  mismatchReason: DiscoveryPreferenceRejectionReason
): {
  active: boolean;
  score: number;
  rejection: DiscoveryPreferenceRejectionReason | null;
} {
  const wanted = uniqueTokens(selected);
  if (wanted.length === 0) return { active: false, score: NEUTRAL_SCORE, rejection: null };

  const available = uniqueTokens(candidateValues ?? []);
  if (available.length === 0) {
    return mode === 'require'
      ? { active: true, score: 0, rejection: missingReason }
      : { active: true, score: 0, rejection: null };
  }

  const availableSet = new Set(available);
  const matches = wanted.filter((value) => availableSet.has(value)).length;
  const score = matches / wanted.length;

  if (mode === 'require' && matches === 0) {
    return { active: true, score: 0, rejection: mismatchReason };
  }

  return { active: true, score, rejection: null };
}

function evaluateReciprocity(
  viewer: IUserDados,
  candidate: IUserDados,
  accepted: DiscoveryPreferenceFilterResult
): DiscoveryPreferenceFilterResult {
  if (!hasExplicitCompatibilityInterest(viewer, normalizePreferences(viewer.discoveryPreferences))) {
    return accepted;
  }
  return evaluateProfileCompatibility(viewer, candidate).compatible
    ? accepted
    : rejected('reciprocal_mismatch');
}

function normalizePreferences(
  value: IUserDiscoveryPreferences | null | undefined
): IUserDiscoveryPreferences | null {
  if (!value) return null;
  const ageMin = finiteNumber(value.ageRange?.min);
  const ageMax = finiteNumber(value.ageRange?.max);
  const distance = finiteNumber(value.maxDistanceKm);

  return {
    genderInterests: Array.from(new Set(value.genderInterests ?? [])),
    relationshipIntents: uniqueTokens(value.relationshipIntents ?? []) as IUserDiscoveryPreferences['relationshipIntents'],
    acceptsCouples: value.acceptsCouples !== false,
    acceptsSingles: value.acceptsSingles !== false,
    acceptsTransProfiles: value.acceptsTransProfiles === true
      ? true
      : value.acceptsTransProfiles === false ? false : null,
    ageRange: ageMin !== null && ageMax !== null
      ? { min: Math.min(ageMin, ageMax), max: Math.max(ageMin, ageMax) }
      : null,
    maxDistanceKm: distance === null ? null : Math.max(1, distance),
    locationRequired: value.locationRequired === true,
    relationshipIntentMode: value.relationshipIntentMode === 'prefer' ? 'prefer' : 'require',
    sexualPractices: uniqueTokens(value.sexualPractices ?? []),
    sexualPracticeMode: value.sexualPracticeMode === 'require' ? 'require' : 'prefer',
    bodyPreferences: uniqueTokens(value.bodyPreferences ?? []),
    bodyPreferenceMode: value.bodyPreferenceMode === 'require' ? 'require' : 'prefer',
    updatedAt: finiteNumber(value.updatedAt) ?? 0,
  };
}

function resolveAdvancedAccess(viewer: IUserDados): { basic: boolean; premium: boolean } {
  if (viewer.role === 'admin') return { basic: true, premium: true };
  const projection = evaluatePlatformSubscriptionProjection(viewer);
  const role = projection.active ? projection.role : null;
  return {
    basic: hasMinimumPlatformSubscriptionRole(role, 'basic'),
    premium: hasMinimumPlatformSubscriptionRole(role, 'premium'),
  };
}

function resolveCandidateGender(candidate: IUserDados): NormalizedDiscoveryGender {
  return normalizeDiscoveryGender(candidate.normalizedGender ?? candidate.gender ?? null);
}

function candidateMatchesInterest(
  candidate: IUserDados,
  candidateGender: NormalizedDiscoveryGender,
  interest: UserDiscoveryGenderInterest
): boolean {
  const raw = collectIdentityText(candidate);
  switch (interest) {
    case 'men': return candidateGender === 'man';
    case 'women': return candidateGender === 'woman';
    case 'couple_mm': return matchesCoupleVariant(candidate, 'male_male');
    case 'couple_mf': return matchesCoupleVariant(candidate, 'male_female');
    case 'couple_ff': return matchesCoupleVariant(candidate, 'female_female');
    case 'travestis': return candidateGender === 'travesti' || hasAnyToken(raw, ['travesti']);
    case 'trans_people': return ['trans_woman', 'trans_man', 'transgender'].includes(candidateGender)
      || hasAnyToken(raw, ['mulher-trans', 'homem-trans', 'transexual', 'transgenero', 'transgender']);
    case 'crossdressers': return candidateGender === 'crossdresser' || hasAnyToken(raw, ['crossdresser']);
    case 'non_binary': return candidateGender === 'nonbinary' || hasAnyToken(raw, ['nao-binario', 'nonbinary']);
    case 'intersex': return hasAnyToken(raw, ['intersexo', 'intersex']);
    case 'drag_queen': return hasAnyToken(raw, ['drag-queen', 'dragqueen']);
    case 'drag_king': return hasAnyToken(raw, ['drag-king', 'dragking']);
    case 'genderfluid': return hasAnyToken(raw, ['genero-fluido', 'genderfluid', 'fluxo-de-genero']);
    case 'agender': return hasAnyToken(raw, ['agenero', 'agender']);
    case 'genderqueer': return hasAnyToken(raw, ['genero-queer', 'genderqueer']);
    case 'androgynous': return hasAnyToken(raw, ['androgino', 'androgina', 'androgynous']);
    default: return false;
  }
}

function matchesCoupleVariant(
  candidate: IUserDados,
  expected: 'male_male' | 'male_female' | 'female_female'
): boolean {
  const source = candidate as IUserDados & Record<string, unknown>;
  const variant = normalizeDiscoveryCoupleVariant(source['coupleVariant'])
    ?? normalizeDiscoveryCoupleVariant(source['casalVariant'])
    ?? normalizeDiscoveryCoupleVariant(source['tipoCasal'])
    ?? normalizeDiscoveryCoupleVariant(candidate.gender);
  return resolveCandidateGender(candidate) === 'couple' && variant === expected;
}

function isTransProfile(candidate: IUserDados, gender: NormalizedDiscoveryGender): boolean {
  return TRANS_GENDERS.has(gender)
    || hasAnyToken(collectIdentityText(candidate), [
      'transgenero', 'transgender', 'transexual', 'transsexual',
      'mulher-trans', 'homem-trans', 'travesti',
    ]);
}

function hasExplicitCompatibilityInterest(
  viewer: IUserDados,
  preferences: IUserDiscoveryPreferences | null
): boolean {
  if ((preferences?.genderInterests.length ?? 0) > 0) return true;
  const interested = viewer.interestedInGenders;
  return Array.isArray(interested)
    ? interested.length > 0
    : typeof interested === 'string' && interested.trim().length > 0;
}

function acceptedResult(
  preferenceScore = NEUTRAL_SCORE,
  matchedSignals: readonly DiscoveryPreferenceMatchSignal[] = []
): DiscoveryPreferenceFilterResult {
  return { accepted: true, reason: null, preferenceScore, matchedSignals };
}

function rejected(reason: DiscoveryPreferenceRejectionReason): DiscoveryPreferenceFilterResult {
  return { accepted: false, reason, preferenceScore: 0, matchedSignals: [] };
}

function averageOrNeutral(values: readonly number[]): number {
  return values.length
    ? Math.max(0, Math.min(1, values.reduce((sum, value) => sum + value, 0) / values.length))
    : NEUTRAL_SCORE;
}

function uniqueTokens(values: readonly unknown[]): string[] {
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collectIdentityText(candidate: IUserDados): string {
  const source = candidate as IUserDados & Record<string, unknown>;
  return [source['normalizedGender'], source['gender'], source['genero'], source['coupleVariant'], source['casalVariant'], source['tipoCasal']]
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeToken)
    .join(' ');
}

function hasAnyToken(source: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => source.includes(normalizeToken(token)));
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '-');
}

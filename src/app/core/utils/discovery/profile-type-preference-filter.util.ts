// src/app/core/utils/discovery/profile-type-preference-filter.util.ts
// -----------------------------------------------------------------------------
// FILTRO PURO DE TIPOS DE PERFIL
// -----------------------------------------------------------------------------
// Responsabilidade:
// - aplicar as escolhas explícitas do próprio usuário;
// - distinguir perfis individuais e variantes de casal;
// - respeitar a opção sobre perfis trans;
// - preservar a reciprocidade já calculada pelo motor canônico;
// - não consultar Firestore e não emitir logs com dados pessoais.
// -----------------------------------------------------------------------------

import type { IUserDados } from '../../interfaces/iuser-dados';
import type {
  IUserDiscoveryPreferences,
  UserDiscoveryGenderInterest,
} from '../../interfaces/preferences/user-discovery-preferences.interface';
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
  | 'reciprocal_mismatch';

export interface DiscoveryPreferenceFilterResult {
  accepted: boolean;
  reason: DiscoveryPreferenceRejectionReason | null;
}

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
  if (!viewer?.uid || !candidate?.uid) {
    return { accepted: true, reason: null };
  }

  const preferences = normalizePreferences(viewer.discoveryPreferences);
  const candidateGender = resolveCandidateGender(candidate);
  const isCouple = candidateGender === 'couple';

  if (preferences) {
    if (isCouple && !preferences.acceptsCouples) {
      return { accepted: false, reason: 'couples_disabled' };
    }

    if (!isCouple && !preferences.acceptsSingles) {
      return { accepted: false, reason: 'singles_disabled' };
    }

    if (
      preferences.acceptsTransProfiles === false &&
      isTransProfile(candidate, candidateGender)
    ) {
      return { accepted: false, reason: 'trans_profiles_disabled' };
    }

    if (
      preferences.genderInterests.length > 0 &&
      !preferences.genderInterests.some((interest) =>
        candidateMatchesInterest(candidate, candidateGender, interest)
      )
    ) {
      return { accepted: false, reason: 'profile_type_not_selected' };
    }
  }

  if (hasExplicitCompatibilityInterest(viewer, preferences)) {
    const compatibility = evaluateProfileCompatibility(viewer, candidate);

    if (!compatibility.compatible) {
      return { accepted: false, reason: 'reciprocal_mismatch' };
    }
  }

  return { accepted: true, reason: null };
}

function normalizePreferences(
  value: IUserDiscoveryPreferences | null | undefined
): IUserDiscoveryPreferences | null {
  if (!value) return null;

  return {
    genderInterests: Array.from(
      new Set((value.genderInterests ?? []).filter(Boolean))
    ),
    acceptsCouples: value.acceptsCouples !== false,
    acceptsSingles: value.acceptsSingles !== false,
    acceptsTransProfiles:
      value.acceptsTransProfiles === true
        ? true
        : value.acceptsTransProfiles === false
          ? false
          : null,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  };
}

function resolveCandidateGender(candidate: IUserDados): NormalizedDiscoveryGender {
  return normalizeDiscoveryGender(
    candidate.normalizedGender ?? candidate.gender ?? null
  );
}

function candidateMatchesInterest(
  candidate: IUserDados,
  candidateGender: NormalizedDiscoveryGender,
  interest: UserDiscoveryGenderInterest
): boolean {
  const raw = collectIdentityText(candidate);

  switch (interest) {
    case 'men':
      return candidateGender === 'man';

    case 'women':
      return candidateGender === 'woman';

    case 'couple_mm':
      return matchesCoupleVariant(candidate, 'male_male');

    case 'couple_mf':
      return matchesCoupleVariant(candidate, 'male_female');

    case 'couple_ff':
      return matchesCoupleVariant(candidate, 'female_female');

    case 'travestis':
      return candidateGender === 'travesti' || hasAnyToken(raw, ['travesti', 'travestis']);

    case 'trans_people':
      return (
        candidateGender === 'trans_woman' ||
        candidateGender === 'trans_man' ||
        candidateGender === 'transgender' ||
        hasAnyToken(raw, [
          'mulher-trans',
          'homem-trans',
          'transexual-mulher',
          'transexual-homem',
          'transgenero',
          'transgender',
        ])
      );

    case 'crossdressers':
      return candidateGender === 'crossdresser' || hasAnyToken(raw, ['crossdresser', 'crossdressers']);

    case 'non_binary':
      return candidateGender === 'nonbinary' || hasAnyToken(raw, ['nao-binario', 'nonbinary', 'non-binary']);

    case 'intersex':
      return hasAnyToken(raw, ['intersexo', 'intersex']);

    case 'drag_queen':
      return hasAnyToken(raw, ['drag-queen', 'dragqueen']);

    case 'drag_king':
      return hasAnyToken(raw, ['drag-king', 'dragking']);

    case 'genderfluid':
      return hasAnyToken(raw, ['genero-fluido', 'genderfluid', 'fluxo-de-genero']);

    case 'agender':
      return hasAnyToken(raw, ['agenero', 'agender']);

    case 'genderqueer':
      return hasAnyToken(raw, ['genero-queer', 'genderqueer']);

    case 'androgynous':
      return hasAnyToken(raw, ['androgino', 'androgina', 'androgynous']);

    default:
      return false;
  }
}

function matchesCoupleVariant(
  candidate: IUserDados,
  expected: 'male_male' | 'male_female' | 'female_female'
): boolean {
  const source = candidate as IUserDados & Record<string, unknown>;
  const variant =
    normalizeDiscoveryCoupleVariant(source['coupleVariant']) ??
    normalizeDiscoveryCoupleVariant(source['casalVariant']) ??
    normalizeDiscoveryCoupleVariant(source['tipoCasal']) ??
    normalizeDiscoveryCoupleVariant(candidate.gender);

  return resolveCandidateGender(candidate) === 'couple' && variant === expected;
}

function isTransProfile(
  candidate: IUserDados,
  candidateGender: NormalizedDiscoveryGender
): boolean {
  if (TRANS_GENDERS.has(candidateGender)) return true;

  const raw = collectIdentityText(candidate);
  return hasAnyToken(raw, [
    'transgenero',
    'transgender',
    'transexual',
    'transsexual',
    'mulher-trans',
    'homem-trans',
    'travesti',
  ]);
}

function hasExplicitCompatibilityInterest(
  viewer: IUserDados,
  preferences: IUserDiscoveryPreferences | null
): boolean {
  if ((preferences?.genderInterests.length ?? 0) > 0) return true;

  const interested = viewer.interestedInGenders;
  if (Array.isArray(interested)) return interested.length > 0;
  return typeof interested === 'string' && interested.trim().length > 0;
}

function collectIdentityText(candidate: IUserDados): string {
  const source = candidate as IUserDados & Record<string, unknown>;

  return [
    source['normalizedGender'],
    source['gender'],
    source['genero'],
    source['coupleVariant'],
    source['casalVariant'],
    source['tipoCasal'],
  ]
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeToken)
    .join(' ');
}

function hasAnyToken(source: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => source.includes(normalizeToken(token)));
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '-');
}

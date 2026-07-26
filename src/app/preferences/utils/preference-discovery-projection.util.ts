// src/app/preferences/utils/preference-discovery-projection.util.ts
// -----------------------------------------------------------------------------
// PROJEÇÃO DO PERFIL DE PREFERÊNCIAS PARA DISCOVERY
// -----------------------------------------------------------------------------
// Mantém dois níveis:
// - discoveryPreferences: seleção exata e privada usada pelo filtro local;
// - interestedInGenders: categorias canônicas amplas usadas pelo motor recíproco
//   e pela projeção pública produzida no backend.
// -----------------------------------------------------------------------------

import {
  IUserDiscoveryPreferences,
  UserDiscoveryGenderInterest,
} from '@core/interfaces/preferences/user-discovery-preferences.interface';
import { PreferenceProfile } from '../models/preference-profile.model';

export type CanonicalDiscoveryGender =
  | 'man'
  | 'woman'
  | 'couple'
  | 'trans_woman'
  | 'trans_man'
  | 'travesti'
  | 'transgender'
  | 'crossdresser'
  | 'nonbinary';

export interface PreferenceDiscoveryProjection {
  interestedInGenders: readonly CanonicalDiscoveryGender[];
  discoveryPreferences: IUserDiscoveryPreferences;
}

const INTEREST_TO_CANONICAL: Readonly<
  Record<UserDiscoveryGenderInterest, readonly CanonicalDiscoveryGender[]>
> = Object.freeze({
  men: ['man'],
  women: ['woman'],
  couple_mm: ['couple'],
  couple_mf: ['couple'],
  couple_ff: ['couple'],
  travestis: ['travesti'],
  trans_people: ['trans_woman', 'trans_man', 'transgender'],
  crossdressers: ['crossdresser'],
  non_binary: ['nonbinary'],
  intersex: ['nonbinary'],
  drag_queen: ['nonbinary'],
  drag_king: ['nonbinary'],
  genderfluid: ['nonbinary'],
  agender: ['nonbinary'],
  genderqueer: ['nonbinary'],
  androgynous: ['nonbinary'],
});

const TRANS_CANONICAL = new Set<CanonicalDiscoveryGender>([
  'trans_woman',
  'trans_man',
  'travesti',
  'transgender',
]);

export function buildPreferenceDiscoveryProjection(
  profile: PreferenceProfile
): PreferenceDiscoveryProjection {
  const genderInterests = uniqueInterests(
    profile.hardRules?.acceptedGenders ?? []
  );

  const discoveryPreferences: IUserDiscoveryPreferences = {
    genderInterests,
    acceptsCouples: profile.hardRules?.acceptsCouples !== false,
    acceptsSingles: profile.hardRules?.acceptsSingles !== false,
    acceptsTransProfiles:
      profile.hardRules?.acceptsTransProfiles === true
        ? true
        : profile.hardRules?.acceptsTransProfiles === false
          ? false
          : null,
    updatedAt: Number.isFinite(profile.updatedAt)
      ? profile.updatedAt
      : Date.now(),
  };

  let canonical = unique(
    genderInterests.flatMap((interest) => INTEREST_TO_CANONICAL[interest] ?? [])
  );

  if (!discoveryPreferences.acceptsCouples) {
    canonical = canonical.filter((gender) => gender !== 'couple');
  }

  if (!discoveryPreferences.acceptsSingles) {
    canonical = canonical.filter((gender) => gender === 'couple');
  }

  if (discoveryPreferences.acceptsTransProfiles === false) {
    canonical = canonical.filter((gender) => !TRANS_CANONICAL.has(gender));
  }

  return {
    interestedInGenders: canonical,
    discoveryPreferences,
  };
}

function uniqueInterests(
  values: readonly UserDiscoveryGenderInterest[]
): readonly UserDiscoveryGenderInterest[] {
  return Array.from(new Set((values ?? []).filter(Boolean)));
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

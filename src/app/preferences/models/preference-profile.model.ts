// src/app/preferences/models/preference-profile.model.ts
// Preferências estáveis do usuário.
// Não guarda role.
// Role continua canônico em IUserDados/Auth e é consumido por capability services.

import {
  BodyPreference,
  DiscoveryMode,
  GenderInterest,
  PreferenceMatchMode,
  RelationshipIntent,
  SexualPractice,
} from './preference.types';

export interface PreferenceAgeRange {
  min: number;
  max: number;
}

export interface PreferenceHardRules {
  acceptedGenders: GenderInterest[];
  acceptedRelationshipIntents: RelationshipIntent[];
  ageRange: PreferenceAgeRange | null;
  maxDistanceKm: number | null;

  acceptsCouples: boolean;
  acceptsSingles: boolean;
  acceptsTransProfiles: boolean | null;
  locationRequired: boolean;
}

export interface PreferenceSoftRules {
  /** Características que o usuário procura em outras pessoas. */
  bodyPreferences: BodyPreference[];
  sexualPractices: SexualPractice[];
  vibes: string[];
  styles: string[];
  interests: string[];
}

export interface PreferenceSelfTraits {
  /** Características que o próprio usuário escolheu declarar sobre si. */
  bodyTraits: BodyPreference[];
}

export interface PreferenceMatchingModes {
  /** Intenções são essenciais e podem ser exigidas em qualquer plano. */
  relationshipIntents: PreferenceMatchMode;

  /** Preferir exige Básico; transformar em filtro rígido exige Premium. */
  sexualPractices: PreferenceMatchMode;
  bodyPreferences: PreferenceMatchMode;
}

export interface PreferenceVisibilitySettings {
  showPreferenceBadges: boolean;
  showIntentPublicly: boolean;
  discoveryMode: DiscoveryMode;
}

export interface PreferenceProfile {
  userId: string;

  relationshipIntents: RelationshipIntent[];

  hardRules: PreferenceHardRules;
  softRules: PreferenceSoftRules;
  selfTraits: PreferenceSelfTraits;
  matchingModes: PreferenceMatchingModes;
  visibility: PreferenceVisibilitySettings;

  updatedAt: number;
}

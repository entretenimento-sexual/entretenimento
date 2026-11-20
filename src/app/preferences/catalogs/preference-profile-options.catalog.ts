// src/app/preferences/catalogs/preference-profile-options.catalog.ts
// Catálogos do formulário de PreferenceProfile.
// Mantém listas fora do componente visual para reduzir acoplamento e facilitar expansão.

import {
  PUBLIC_BODY_TRAIT_OPTIONS,
  PUBLIC_GENDER_INTEREST_OPTIONS,
  PUBLIC_RELATIONSHIP_INTENT_OPTIONS,
  PUBLIC_SEXUAL_PRACTICE_OPTIONS,
} from 'src/app/core/catalogs/public-preference-options.catalog';

import {
  BodyPreference,
  DiscoveryMode,
  GenderInterest,
  RelationshipIntent,
  SexualPractice,
} from '../models/preference.types';

export interface PreferenceOption<T extends string> {
  key: T;
  label: string;
}

/**
 * As chaves vêm do catálogo público. Os rótulos do editor podem acompanhar a linguagem do cadastro.
 */
const relationshipLabels: Partial<Record<RelationshipIntent, string>> = {
  dating: 'Encontros',
  serious: 'Relacionamento sério',
};

const genderInterestLabels: Partial<Record<GenderInterest, string>> = {
  couple_mm: 'Casal (Ele/Ele)',
  couple_mf: 'Casal (Ele/Ela)',
  couple_ff: 'Casal (Ela/Ela)',
};

export const RELATIONSHIP_INTENT_OPTIONS: ReadonlyArray<PreferenceOption<RelationshipIntent>> =
  PUBLIC_RELATIONSHIP_INTENT_OPTIONS.map(({ key, label }) => ({ key, label: relationshipLabels[key] ?? label }));

export const GENDER_INTEREST_OPTIONS: ReadonlyArray<PreferenceOption<GenderInterest>> =
  PUBLIC_GENDER_INTEREST_OPTIONS.map(({ key, label }) => ({ key, label: genderInterestLabels[key] ?? label }));

export const SEXUAL_PRACTICE_OPTIONS: ReadonlyArray<PreferenceOption<SexualPractice>> =
  PUBLIC_SEXUAL_PRACTICE_OPTIONS;

export const BODY_PREFERENCE_OPTIONS: ReadonlyArray<PreferenceOption<BodyPreference>> =
  PUBLIC_BODY_TRAIT_OPTIONS;

export const DISCOVERY_MODE_OPTIONS: ReadonlyArray<PreferenceOption<DiscoveryMode>> = [
  { key: 'standard', label: 'Padrão' },
  { key: 'discreet', label: 'Discreto' },
  { key: 'priority', label: 'Prioritário' },
];
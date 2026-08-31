// src/app/preferences/catalogs/preference-profile-options.catalog.ts
// Catálogos do formulário de PreferenceProfile.
// Mantém listas fora do componente visual para reduzir acoplamento e facilitar expansão.

import {
  PUBLIC_BODY_TRAIT_OPTIONS,
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
 * Os três catálogos abaixo são aliases tipados do catálogo público canônico.
 * Mantemos estes nomes por compatibilidade com o módulo de Preferências.
 */
export const RELATIONSHIP_INTENT_OPTIONS: ReadonlyArray<PreferenceOption<RelationshipIntent>> =
  PUBLIC_RELATIONSHIP_INTENT_OPTIONS;

export const GENDER_INTEREST_OPTIONS: ReadonlyArray<PreferenceOption<GenderInterest>> = [
  { key: 'men', label: 'Homens' },
  { key: 'women', label: 'Mulheres' },
  { key: 'couple_mm', label: 'Casal MM' },
  { key: 'couple_mf', label: 'Casal MF' },
  { key: 'couple_ff', label: 'Casal FF' },
  { key: 'travestis', label: 'Travestis' },
  { key: 'trans_people', label: 'Pessoas trans' },
  { key: 'crossdressers', label: 'Crossdressers' },
  { key: 'non_binary', label: 'Não binário' },
  { key: 'intersex', label: 'Intersexo' },
  { key: 'drag_queen', label: 'Drag Queen' },
  { key: 'drag_king', label: 'Drag King' },
  { key: 'genderfluid', label: 'Genderfluid' },
  { key: 'agender', label: 'Agênero' },
  { key: 'genderqueer', label: 'Genderqueer' },
  { key: 'androgynous', label: 'Andrógino' },
];

export const SEXUAL_PRACTICE_OPTIONS: ReadonlyArray<PreferenceOption<SexualPractice>> =
  PUBLIC_SEXUAL_PRACTICE_OPTIONS;

export const BODY_PREFERENCE_OPTIONS: ReadonlyArray<PreferenceOption<BodyPreference>> =
  PUBLIC_BODY_TRAIT_OPTIONS;

export const DISCOVERY_MODE_OPTIONS: ReadonlyArray<PreferenceOption<DiscoveryMode>> = [
  { key: 'standard', label: 'Padrão' },
  { key: 'discreet', label: 'Discreto' },
  { key: 'priority', label: 'Prioritário' },
];
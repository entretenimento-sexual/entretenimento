// src/app/preferences/catalogs/preference-profile-options.catalog.ts
// Catálogos do formulário de PreferenceProfile.
// Mantém listas fora do componente visual para reduzir acoplamento e facilitar expansão.

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

export const RELATIONSHIP_INTENT_OPTIONS: ReadonlyArray<PreferenceOption<RelationshipIntent>> = [
  { key: 'friendship', label: 'Amizade' },
  { key: 'casual', label: 'Casual' },
  { key: 'dating', label: 'Dating' },
  { key: 'serious', label: 'Sério' },
  { key: 'open_relationship', label: 'Relacionamento aberto' },
  { key: 'polyamory', label: 'Poliamor' },
  { key: 'swing', label: 'Swing' },
  { key: 'fetish_exploration', label: 'Exploração fetichista' },
];

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

export const SEXUAL_PRACTICE_OPTIONS: ReadonlyArray<PreferenceOption<SexualPractice>> = [
  { key: 'vanilla', label: 'Sexo baunilha' },
  { key: 'bdsm', label: 'BDSM' },
  { key: 'voyeurism', label: 'Voyeurismo' },
  { key: 'exhibitionism', label: 'Exibicionismo' },
  { key: 'swing', label: 'Swing' },
  { key: 'menage', label: 'Menage' },
  { key: 'group_sex', label: 'Sexo grupal' },
  { key: 'roleplay', label: 'Roleplay' },
  { key: 'tantra', label: 'Tantra' },
  { key: 'dom_sub', label: 'Dominação e submissão' },
  { key: 'outdoor', label: 'Ao ar livre' },
  { key: 'fetishes', label: 'Fetiches' },
  { key: 'edge_play', label: 'Edge play' },
  { key: 'shibari', label: 'Shibari' },
  { key: 'cuckold', label: 'Cuckold' },
  { key: 'pegging', label: 'Pegging' },
  { key: 'sensory_play', label: 'Sensory play' },
  { key: 'dirty_talk', label: 'Dirty talk' },
];

export const BODY_PREFERENCE_OPTIONS: ReadonlyArray<PreferenceOption<BodyPreference>> = [
  { key: 'athletic', label: 'Atlético' },
  { key: 'plus_size', label: 'Plus size' },
  { key: 'tattoos', label: 'Tatuagens' },
  { key: 'piercings', label: 'Piercings' },
  { key: 'beard', label: 'Barba' },
  { key: 'long_hair', label: 'Cabelos longos' },
  { key: 'curly_hair', label: 'Cabelos cacheados' },
  { key: 'light_eyes', label: 'Olhos claros' },
  { key: 'muscular', label: 'Musculoso' },
  { key: 'slim', label: 'Magro' },
  { key: 'curvy', label: 'Curvilíneo' },
];

export const DISCOVERY_MODE_OPTIONS: ReadonlyArray<PreferenceOption<DiscoveryMode>> = [
  { key: 'standard', label: 'Padrão' },
  { key: 'discreet', label: 'Discreto' },
  { key: 'priority', label: 'Prioritário' },
];
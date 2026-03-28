// src/app/preferences/models/preference.types.ts
// Tipos centrais do domínio de preferências.
// Objetivo:
// - dar nome claro às capacidades do produto
// - evitar espalhar unions literais pelo projeto
// - preparar expansão futura sem depender do legado
export type DiscoveryMode =
  | 'standard'
  | 'discreet'
  | 'priority';

export type IntentMode =
  | 'inactive'
  | 'chat'
  | 'meet_today'
  | 'casual'
  | 'dating'
  | 'serious'
  | 'fetish'
  | 'travel';

export type RelationshipIntent =
  | 'friendship'
  | 'casual'
  | 'dating'
  | 'serious'
  | 'open_relationship'
  | 'polyamory'
  | 'swing'
  | 'fetish_exploration';

export type GenderInterest =
  | 'men'
  | 'women'
  | 'couple_mm'
  | 'couple_mf'
  | 'couple_ff'
  | 'travestis'
  | 'trans_people'
  | 'crossdressers'
  | 'non_binary'
  | 'intersex'
  | 'drag_queen'
  | 'drag_king'
  | 'genderfluid'
  | 'agender'
  | 'genderqueer'
  | 'androgynous';

export type SexualPractice =
  | 'vanilla'
  | 'bdsm'
  | 'voyeurism'
  | 'exhibitionism'
  | 'swing'
  | 'menage'
  | 'group_sex'
  | 'roleplay'
  | 'tantra'
  | 'dom_sub'
  | 'outdoor'
  | 'fetishes'
  | 'edge_play'
  | 'shibari'
  | 'cuckold'
  | 'pegging'
  | 'sensory_play'
  | 'dirty_talk';

export type BodyPreference =
  | 'athletic'
  | 'plus_size'
  | 'tattoos'
  | 'piercings'
  | 'beard'
  | 'long_hair'
  | 'curly_hair'
  | 'light_eyes'
  | 'muscular'
  | 'slim'
  | 'curvy';

export type PreferenceFeature =
  | 'advanced_discovery'
  | 'discreet_mode'
  | 'priority_visibility'
  | 'intent_boost'
  | 'advanced_preferences'
  | 'compatibility_insights';
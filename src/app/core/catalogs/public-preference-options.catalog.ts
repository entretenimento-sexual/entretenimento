// src/app/core/catalogs/public-preference-options.catalog.ts
// -----------------------------------------------------------------------------
// PUBLIC PREFERENCE LABELS
// -----------------------------------------------------------------------------
// Catálogo canônico de labels que podem aparecer em superfícies públicas.
// Mantém o core independente do módulo de Preferências e evita duplicação de
// rótulos entre discovery, hover de perfil e futuras superfícies sociais.
// -----------------------------------------------------------------------------

export interface PublicPreferenceOption {
  readonly key: string;
  readonly label: string;
}

export const PUBLIC_RELATIONSHIP_INTENT_OPTIONS = [
  { key: 'friendship', label: 'Amizade' },
  { key: 'casual', label: 'Casual' },
  { key: 'dating', label: 'Dating' },
  { key: 'serious', label: 'Sério' },
  { key: 'open_relationship', label: 'Relacionamento aberto' },
  { key: 'polyamory', label: 'Poliamor' },
  { key: 'swing', label: 'Swing' },
  { key: 'fetish_exploration', label: 'Exploração fetichista' },
] as const satisfies readonly PublicPreferenceOption[];

export const PUBLIC_SEXUAL_PRACTICE_OPTIONS = [
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
] as const satisfies readonly PublicPreferenceOption[];

export const PUBLIC_BODY_TRAIT_OPTIONS = [
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
] as const satisfies readonly PublicPreferenceOption[];

const RELATIONSHIP_LABELS = new Map(
  PUBLIC_RELATIONSHIP_INTENT_OPTIONS.map(({ key, label }) => [key, label] as const)
);
const SEXUAL_PRACTICE_LABELS = new Map(
  PUBLIC_SEXUAL_PRACTICE_OPTIONS.map(({ key, label }) => [key, label] as const)
);
const BODY_TRAIT_LABELS = new Map(
  PUBLIC_BODY_TRAIT_OPTIONS.map(({ key, label }) => [key, label] as const)
);

export type PublicPreferenceKind = 'relationship' | 'body_trait' | 'sexual_practice';

export function resolvePublicPreferenceLabel(
  kind: PublicPreferenceKind,
  key: unknown
): string | null {
  const normalizedKey = String(key ?? '').trim();
  if (!normalizedKey) return null;

  switch (kind) {
    case 'relationship':
      return RELATIONSHIP_LABELS.get(normalizedKey) ?? null;
    case 'body_trait':
      return BODY_TRAIT_LABELS.get(normalizedKey) ?? null;
    case 'sexual_practice':
      return SEXUAL_PRACTICE_LABELS.get(normalizedKey) ?? null;
    default:
      return null;
  }
}

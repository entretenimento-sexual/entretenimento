// functions/src/community/community-tag.catalog.ts
// -----------------------------------------------------------------------------
// COMMUNITY TAG CATALOG
// -----------------------------------------------------------------------------
// Catálogo autoritativo de tags de Comunidade.
//
// IDs são namespaced por categoria editorial. Uma tag pública pode representar
// mais de um sinal privado de Preferences/Discovery quando os domínios usam o
// mesmo conceito (ex.: Swing). Assim evitamos duplicidade na UI sem perder a
// capacidade de correlação futura. Preferências privadas nunca são copiadas para
// Comunidades.
// -----------------------------------------------------------------------------

export type CommunityTagCategory = 'intent' | 'practice' | 'audience';
export type CommunityPreferenceSignalDomain =
  | 'relationshipIntent'
  | 'sexualPractice'
  | 'genderInterest';

export interface CommunityPreferenceSignal {
  domain: CommunityPreferenceSignalDomain;
  key: string;
}

export interface CommunityTagDefinition {
  id: string;
  label: string;
  category: CommunityTagCategory;
  preferenceSignals: readonly CommunityPreferenceSignal[];
}

export const MIN_COMMUNITY_TAGS = 1;
export const MAX_COMMUNITY_TAGS = 6;

const COMMUNITY_TAGS: readonly CommunityTagDefinition[] = Object.freeze([
  {
    id: 'intent:friendship',
    label: 'Amizade',
    category: 'intent',
    preferenceSignals: [{ domain: 'relationshipIntent', key: 'friendship' }],
  },
  {
    id: 'intent:casual',
    label: 'Casual',
    category: 'intent',
    preferenceSignals: [{ domain: 'relationshipIntent', key: 'casual' }],
  },
  {
    id: 'intent:dating',
    label: 'Dating',
    category: 'intent',
    preferenceSignals: [{ domain: 'relationshipIntent', key: 'dating' }],
  },
  {
    id: 'intent:serious',
    label: 'Relacionamento sério',
    category: 'intent',
    preferenceSignals: [{ domain: 'relationshipIntent', key: 'serious' }],
  },
  {
    id: 'intent:open_relationship',
    label: 'Relacionamento aberto',
    category: 'intent',
    preferenceSignals: [
      { domain: 'relationshipIntent', key: 'open_relationship' },
    ],
  },
  {
    id: 'intent:polyamory',
    label: 'Poliamor',
    category: 'intent',
    preferenceSignals: [{ domain: 'relationshipIntent', key: 'polyamory' }],
  },
  {
    id: 'intent:swing',
    label: 'Swing',
    category: 'intent',
    preferenceSignals: [
      { domain: 'relationshipIntent', key: 'swing' },
      { domain: 'sexualPractice', key: 'swing' },
    ],
  },
  {
    id: 'intent:fetish_exploration',
    label: 'Exploração fetichista',
    category: 'intent',
    preferenceSignals: [
      { domain: 'relationshipIntent', key: 'fetish_exploration' },
    ],
  },

  {
    id: 'practice:bdsm',
    label: 'BDSM',
    category: 'practice',
    preferenceSignals: [{ domain: 'sexualPractice', key: 'bdsm' }],
  },
  {
    id: 'practice:voyeurism',
    label: 'Voyeurismo',
    category: 'practice',
    preferenceSignals: [{ domain: 'sexualPractice', key: 'voyeurism' }],
  },
  {
    id: 'practice:exhibitionism',
    label: 'Exibicionismo',
    category: 'practice',
    preferenceSignals: [{ domain: 'sexualPractice', key: 'exhibitionism' }],
  },
  {
    id: 'practice:menage',
    label: 'Menage',
    category: 'practice',
    preferenceSignals: [{ domain: 'sexualPractice', key: 'menage' }],
  },
  {
    id: 'practice:group_sex',
    label: 'Sexo grupal',
    category: 'practice',
    preferenceSignals: [{ domain: 'sexualPractice', key: 'group_sex' }],
  },
  {
    id: 'practice:roleplay',
    label: 'Roleplay',
    category: 'practice',
    preferenceSignals: [{ domain: 'sexualPractice', key: 'roleplay' }],
  },
  {
    id: 'practice:tantra',
    label: 'Tantra',
    category: 'practice',
    preferenceSignals: [{ domain: 'sexualPractice', key: 'tantra' }],
  },
  {
    id: 'practice:dom_sub',
    label: 'Dominação e submissão',
    category: 'practice',
    preferenceSignals: [{ domain: 'sexualPractice', key: 'dom_sub' }],
  },
  {
    id: 'practice:outdoor',
    label: 'Ao ar livre',
    category: 'practice',
    preferenceSignals: [{ domain: 'sexualPractice', key: 'outdoor' }],
  },
  {
    id: 'practice:fetishes',
    label: 'Fetiches',
    category: 'practice',
    preferenceSignals: [{ domain: 'sexualPractice', key: 'fetishes' }],
  },
  {
    id: 'practice:shibari',
    label: 'Shibari',
    category: 'practice',
    preferenceSignals: [{ domain: 'sexualPractice', key: 'shibari' }],
  },

  {
    id: 'audience:men',
    label: 'Homens',
    category: 'audience',
    preferenceSignals: [{ domain: 'genderInterest', key: 'men' }],
  },
  {
    id: 'audience:women',
    label: 'Mulheres',
    category: 'audience',
    preferenceSignals: [{ domain: 'genderInterest', key: 'women' }],
  },
  {
    id: 'audience:couple_mm',
    label: 'Casal MM',
    category: 'audience',
    preferenceSignals: [{ domain: 'genderInterest', key: 'couple_mm' }],
  },
  {
    id: 'audience:couple_mf',
    label: 'Casal MF',
    category: 'audience',
    preferenceSignals: [{ domain: 'genderInterest', key: 'couple_mf' }],
  },
  {
    id: 'audience:couple_ff',
    label: 'Casal FF',
    category: 'audience',
    preferenceSignals: [{ domain: 'genderInterest', key: 'couple_ff' }],
  },
  {
    id: 'audience:trans_people',
    label: 'Pessoas trans',
    category: 'audience',
    preferenceSignals: [{ domain: 'genderInterest', key: 'trans_people' }],
  },
  {
    id: 'audience:non_binary',
    label: 'Não binário',
    category: 'audience',
    preferenceSignals: [{ domain: 'genderInterest', key: 'non_binary' }],
  },
]);

const COMMUNITY_TAG_BY_ID = new Map(
  COMMUNITY_TAGS.map((tag) => [tag.id, tag] as const)
);

export function getCommunityTagCatalog(): readonly CommunityTagDefinition[] {
  return COMMUNITY_TAGS;
}

export function resolveCommunityTagDefinitions(
  rawTagIds: unknown
): readonly CommunityTagDefinition[] {
  if (!Array.isArray(rawTagIds)) return [];

  const requestedIds = new Set(
    rawTagIds
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
  );

  return COMMUNITY_TAGS.filter((tag) => requestedIds.has(tag.id));
}

export function normalizeNewCommunityTagIds(rawTagIds: unknown): string[] | null {
  if (!Array.isArray(rawTagIds)) return null;

  const requestedIds = new Set(
    rawTagIds
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
  );

  if (
    requestedIds.size < MIN_COMMUNITY_TAGS
    || requestedIds.size > MAX_COMMUNITY_TAGS
  ) {
    return null;
  }

  const resolved = COMMUNITY_TAGS.filter((tag) => requestedIds.has(tag.id));
  if (resolved.length !== requestedIds.size) return null;

  return resolved.map((tag) => tag.id);
}

export function isCommunityTagId(value: unknown): boolean {
  return COMMUNITY_TAG_BY_ID.has(String(value ?? '').trim());
}

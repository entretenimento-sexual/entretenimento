import { describe, expect, it } from 'vitest';

import type { PreferenceProfile } from 'src/app/preferences/models/preference-profile.model';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import type { CommunityTagDefinition } from '../data-access/community-tag.model';
import {
  communityContextualMatchLabel,
  personalizeCommunityDiscoveryCards,
  resolveCommunityContextualRelevance,
} from './community-contextual-relevance';

const CATALOG: readonly CommunityTagDefinition[] = [
  {
    id: 'intent:friendship',
    label: 'Amizade',
    category: 'intent',
    preferenceSignals: [
      { domain: 'relationshipIntent', key: 'friendship' },
    ],
  },
  {
    id: 'intent:dating',
    label: 'Encontros',
    category: 'intent',
    preferenceSignals: [
      { domain: 'relationshipIntent', key: 'dating' },
    ],
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
    id: 'practice:bdsm',
    label: 'BDSM',
    category: 'practice',
    preferenceSignals: [
      { domain: 'sexualPractice', key: 'bdsm' },
    ],
  },
];

function profile(): PreferenceProfile {
  return {
    userId: 'viewer-1',
    relationshipIntents: ['friendship', 'dating'],
    hardRules: {
      acceptedGenders: [],
      acceptedRelationshipIntents: [],
      ageRange: null,
      maxDistanceKm: null,
      acceptsCouples: true,
      acceptsSingles: true,
      acceptsTransProfiles: null,
      locationRequired: false,
    },
    softRules: {
      bodyPreferences: [],
      sexualPractices: ['bdsm', 'swing'],
      vibes: [],
      styles: [],
      interests: [],
    },
    selfTraits: { bodyTraits: [] },
    matchingModes: {
      relationshipIntents: 'prefer',
      sexualPractices: 'prefer',
      bodyPreferences: 'prefer',
    },
    visibility: {
      showPreferenceBadges: false,
      showIntentPublicly: false,
      discoveryMode: 'standard',
    },
    updatedAt: 123,
  };
}

function card(
  communityId: string,
  tagIds: readonly string[]
): CommunityPreviewCard {
  const definitions = new Map(CATALOG.map((tag) => [tag.id, tag] as const));

  return {
    communityId,
    name: communityId,
    slug: communityId,
    description: null,
    source: { type: 'community', id: communityId },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 0, postCount: 0, mediaCount: 0 },
    access: {
      join: 'approval',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: tagIds.map((id) => {
      const definition = definitions.get(id);
      if (!definition) throw new Error(`Tag de teste ausente: ${id}`);
      return {
        id: definition.id,
        label: definition.label,
        category: definition.category,
      };
    }),
  };
}

describe('community contextual relevance', () => {
  it('cruza somente sinais canônicos do catálogo com preferências privadas locais', () => {
    const relevance = resolveCommunityContextualRelevance(
      card('community-a', ['intent:friendship', 'practice:bdsm']),
      CATALOG,
      profile()
    );

    expect(relevance?.matches.map((match) => match.tagId)).toEqual([
      'intent:friendship',
      'practice:bdsm',
    ]);
    expect(relevance?.rank).toBe(7);
  });

  it('não duplica peso quando uma tag representa mais de um domínio', () => {
    const relevance = resolveCommunityContextualRelevance(
      card('community-swing', ['intent:swing']),
      CATALOG,
      profile()
    );

    expect(relevance?.matches).toHaveLength(1);
    expect(relevance?.rank).toBe(3);
  });

  it('mantém a primeira posição orgânica e personaliza somente a janela próxima', () => {
    const personalized = personalizeCommunityDiscoveryCards(
      [
        card('organic-first', []),
        card('neutral', []),
        card('friendship', ['intent:friendship']),
        card('bdsm', ['practice:bdsm']),
        card('organic-last', []),
      ],
      CATALOG,
      profile()
    );

    expect(personalized.map((item) => item.communityId)).toEqual([
      'organic-first',
      'friendship',
      'bdsm',
      'neutral',
      'organic-last',
    ]);
  });

  it('limita a promoção contextual a três posições da sequência orgânica disponível', () => {
    const personalized = personalizeCommunityDiscoveryCards(
      [
        card('organic-first', []),
        card('neutral-1', []),
        card('neutral-2', []),
        card('neutral-3', []),
        card('neutral-4', []),
        card('neutral-5', []),
        card('friendship', ['intent:friendship']),
      ],
      CATALOG,
      profile()
    );

    expect(personalized.map((item) => item.communityId)).toEqual([
      'organic-first',
      'neutral-1',
      'neutral-2',
      'friendship',
      'neutral-3',
      'neutral-4',
      'neutral-5',
    ]);
  });

  it('preserva âncoras orgânicas periódicas mesmo com candidatos contextuais próximos', () => {
    const personalized = personalizeCommunityDiscoveryCards(
      [
        card('organic-first', []),
        card('organic-anchor', []),
        card('friendship', ['intent:friendship']),
        card('dating', ['intent:dating']),
        card('bdsm', ['practice:bdsm']),
      ],
      CATALOG,
      profile()
    );

    expect(personalized.map((item) => item.communityId)).toEqual([
      'organic-first',
      'friendship',
      'dating',
      'bdsm',
      'organic-anchor',
    ]);
  });

  it('reduz repetição recente quando candidatos têm afinidade equivalente', () => {
    const personalized = personalizeCommunityDiscoveryCards(
      [
        card('organic-first', []),
        card('friendship-a', ['intent:friendship']),
        card('friendship-b', ['intent:friendship']),
        card('dating', ['intent:dating']),
      ],
      CATALOG,
      profile()
    );

    expect(personalized.map((item) => item.communityId)).toEqual([
      'organic-first',
      'friendship-a',
      'dating',
      'friendship-b',
    ]);
  });

  it('não transforma afinidade contextual em percentual público', () => {
    const [personalized] = personalizeCommunityDiscoveryCards(
      [card('community-a', ['intent:friendship', 'practice:bdsm'])],
      CATALOG,
      profile()
    );

    expect(communityContextualMatchLabel(personalized)).toBe(
      'Combina com 2 interesses seus'
    );
    expect(communityContextualMatchLabel(card('neutral', []))).toBeNull();
  });
});

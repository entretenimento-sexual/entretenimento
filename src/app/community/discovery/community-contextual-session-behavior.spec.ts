import { describe, expect, it } from 'vitest';

import type { PreferenceProfile } from 'src/app/preferences/models/preference-profile.model';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import type { CommunityTagDefinition } from '../data-access/community-tag.model';
import { personalizeCommunityDiscoveryCards } from './community-contextual-relevance';
import type { CommunityDiscoverySessionBehaviorState } from './community-discovery-session-behavior.service';

const CATALOG: readonly CommunityTagDefinition[] = [
  {
    id: 'intent:friendship',
    label: 'Amizade',
    category: 'intent',
    preferenceSignals: [
      { domain: 'relationshipIntent', key: 'friendship' },
    ],
  },
];

const PROFILE: PreferenceProfile = {
  userId: 'viewer-1',
  relationshipIntents: ['friendship'],
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
    sexualPractices: [],
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

function card(communityId: string, tags: CommunityPreviewCard['tags'] = []): CommunityPreviewCard {
  return {
    communityId,
    name: communityId,
    slug: communityId,
    description: null,
    source: { type: 'community', id: communityId },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 1, postCount: 0, mediaCount: 0 },
    access: {
      join: 'approval',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags,
  };
}

describe('community contextual session behavior', () => {
  it('mantém preferência explícita mais forte que comportamento isolado', () => {
    const organic = card('organic');
    const behaviorOnly = card('behavior-only');
    const explicit = card('explicit', [
      { id: 'intent:friendship', label: 'Amizade', category: 'intent' },
    ]);
    const behavior: CommunityDiscoverySessionBehaviorState = {
      hiddenCommunityIds: [],
      signals: {
        'behavior-only': {
          meaningfulOpenCount: 5,
          lastMeaningfulOpenAt: 123,
          memberActive: true,
        },
      },
    };

    const result = personalizeCommunityDiscoveryCards(
      [organic, behaviorOnly, explicit],
      CATALOG,
      PROFILE,
      behavior
    );

    expect(result.map((item) => item.communityId)).toEqual([
      'organic',
      'explicit',
      'behavior-only',
    ]);
  });

  it('remove ocultados somente da apresentação derivada', () => {
    const source = [card('organic'), card('hidden')];
    const behavior: CommunityDiscoverySessionBehaviorState = {
      hiddenCommunityIds: ['hidden'],
      signals: {},
    };

    const result = personalizeCommunityDiscoveryCards(
      source,
      CATALOG,
      null,
      behavior
    );

    expect(result.map((item) => item.communityId)).toEqual(['organic']);
    expect(source.map((item) => item.communityId)).toEqual(['organic', 'hidden']);
  });
});

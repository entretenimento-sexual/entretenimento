// src/app/community/data-access/community-preview-invalid-join.spec.ts
import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityDiscoveryPageResponse,
  normalizeCommunityPreviewResponse,
} from './community-preview.model';

function card(join: unknown) {
  return {
    communityId: 'community-1',
    name: 'Comunidade do Centro',
    slug: 'comunidade-do-centro',
    description: 'Grupo permanente de pessoas da região central.',
    source: { type: 'community', id: 'community-1' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 8, postCount: 3, mediaCount: 2 },
    access: { join },
    tags: [],
  };
}

test('frontend não converte join inválido em approval', () => {
  for (const join of [undefined, null, 'unknown', 123]) {
    expect(
      normalizeCommunityDiscoveryPageResponse({
        items: [card(join)],
        generatedAt: 100,
      }).items
    ).toEqual([]);

    expect(
      normalizeCommunityPreviewResponse({
        community: card(join),
        lifecycleStatus: 'active',
        viewerMode: 'visitor',
        capacity: {
          configuredLimit: 25,
          effectiveLimit: 25,
          memberCount: 8,
          acceptingNewMembers: true,
          restrictedByOwnerPlan: false,
          memberLimitOptions: [],
          allowedMemberLimits: [],
        },
      })
    ).toBeNull();
  }
});

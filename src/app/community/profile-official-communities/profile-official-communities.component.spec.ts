import { describe, expect, it } from 'vitest';

import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { mergeProfileCommunityCards } from './profile-official-communities.component';

function card(
  communityId: string,
  official = false
): CommunityPreviewCard {
  return {
    communityId,
    name: `Comunidade ${communityId}`,
    slug: `comunidade-${communityId}`,
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
    tags: [],
    ...(official
      ? {
        officialAssociation: {
          targetType: 'person',
          targetId: 'profile-1',
          verified: true,
        },
      }
      : {}),
  } as CommunityPreviewCard;
}

describe('mergeProfileCommunityCards', () => {
  it('prioriza oficiais, remove duplicatas e respeita o limite', () => {
    const result = mergeProfileCommunityCards(
      [card('1', true), card('2', true)],
      [card('2'), card('3'), card('4')],
      3
    );

    expect(result.map((item) => item.communityId)).toEqual(['1', '2', '3']);
    expect(result[1]?.officialAssociation?.verified).toBe(true);
  });
});

import type { CommunityPreviewCard } from './community-preview.model';
import { retainCommunitiesForOfficialTarget } from './community-official-target.policy';

function createCard(
  communityId: string,
  officialAssociation?: CommunityPreviewCard['officialAssociation']
): CommunityPreviewCard {
  return {
    communityId,
    name: `Comunidade ${communityId}`,
    slug: `comunidade-${communityId}`,
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
    tags: [],
    ...(officialAssociation ? { officialAssociation } : {}),
  };
}

describe('retainCommunitiesForOfficialTarget', () => {
  const target = {
    type: 'profile' as const,
    id: 'profile-12345678-1234-4123-8123-123456789abc',
  };

  it('mantém apenas associações verificadas do alvo exato', () => {
    const exact = createCard('exact', {
      target,
      verified: true,
    });
    const wrongId = createCard('wrong-id', {
      target: { ...target, id: 'profile-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      verified: true,
    });
    const wrongType = createCard('wrong-type', {
      target: { type: 'organization', id: target.id },
      verified: true,
    });
    const noAssociation = createCard('no-association');

    const result = retainCommunitiesForOfficialTarget(
      {
        items: [exact, wrongId, wrongType, noAssociation],
        nextCursor: 'cursor-1',
        generatedAt: 123,
      },
      target
    );

    expect(result.items).toEqual([exact]);
    expect(result.nextCursor).toBe('cursor-1');
    expect(result.generatedAt).toBe(123);
  });

  it('compara o identificador do alvo de forma exata', () => {
    const caseMismatch = createCard('case-mismatch', {
      target: { ...target, id: target.id.toUpperCase() },
      verified: true,
    });

    const result = retainCommunitiesForOfficialTarget(
      { items: [caseMismatch], nextCursor: null, generatedAt: 456 },
      target
    );

    expect(result.items).toEqual([]);
  });
});

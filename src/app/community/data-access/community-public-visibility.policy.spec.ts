import type {
  CommunityDiscoveryPage,
  CommunityPreviewCard,
} from './community-preview.model';
import { sanitizeCommunityPublicDiscoveryPage } from './community-public-visibility.policy';

function buildCard(
  communityId: string,
  viewerRole: CommunityPreviewCard['viewerRole']
): CommunityPreviewCard {
  return {
    communityId,
    name: `Comunidade ${communityId}`,
    slug: `comunidade-${communityId}`,
    description: null,
    source: {
      type: 'community',
      id: communityId,
    },
    avatarUrl: null,
    coverUrl: null,
    metrics: {
      memberCount: 10,
      postCount: 3,
      mediaCount: 1,
    },
    access: {
      join: 'approval',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [],
    viewerRole,
  };
}

describe('sanitizeCommunityPublicDiscoveryPage', () => {
  it('remove viewerRole de todos os cards em superfícies públicas', () => {
    const source: CommunityDiscoveryPage = {
      items: [
        buildCard('alpha', 'member'),
        buildCard('beta', 'admin'),
      ],
      nextCursor: 'cursor_2',
      generatedAt: 1_725_000_000_000,
    };

    const result = sanitizeCommunityPublicDiscoveryPage(source);

    expect(result.items.length).toBe(2);
    expect(result.items[0].viewerRole).toBeUndefined();
    expect(result.items[1].viewerRole).toBeUndefined();
    expect(result.nextCursor).toBe(source.nextCursor);
    expect(result.generatedAt).toBe(source.generatedAt);
  });

  it('não altera o objeto de origem nem os demais campos públicos', () => {
    const card = buildCard('gamma', 'moderator');
    const source: CommunityDiscoveryPage = {
      items: [card],
      nextCursor: null,
      generatedAt: 123,
    };

    const result = sanitizeCommunityPublicDiscoveryPage(source);

    expect(source.items[0].viewerRole).toBe('moderator');
    expect(result).not.toBe(source);
    expect(result.items[0]).not.toBe(card);
    expect(result.items[0].communityId).toBe('gamma');
    expect(result.items[0].name).toBe(card.name);
  });
});

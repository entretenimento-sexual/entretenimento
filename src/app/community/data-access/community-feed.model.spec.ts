import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityFeedPageResponse,
  normalizeCommunityFeedPostCreateResponse,
  normalizeCommunityFeedPostActionResponse,
  normalizeCommunityFeedReactionResponse,
} from './community-feed.model';

function item(overrides: Record<string, unknown> = {}) {
  return {
    postId: 'post-1',
    kind: 'photo',
    author: {
      label: 'Equipe do local',
      avatarUrl: 'https://example.com/avatar.webp',
      profileType: 'couple',
      profileTypeLabel: 'valor não confiável',
      city: 'Rio de Janeiro',
      state: 'RJ',
      uid: 'private-user-id',
    },
    text: 'Atualização do local.',
    image: {
      url: 'https://example.com/photo.webp',
      alt: 'Foto do local',
    },
    metrics: { commentCount: 2, reactionCount: 7 },
    capabilities: {
      canDeleteOwn: true,
      canModerate: false,
      canReport: false,
      canReact: true,
      viewerReacted: false,
      canViewComments: true,
      canComment: true,
    },
    publishedAt: Date.now() - 60_000,
    ...overrides,
  };
}

describe('normalizeCommunityFeedPageResponse', () => {
  it('normaliza itens, identidade pública, cursor e contadores', () => {
    const page = normalizeCommunityFeedPageResponse({
      items: [item()],
      nextCursor: 'post-1',
      generatedAt: 123,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].author).toEqual({
      profileId: null,
      nickname: 'Equipe do local',
      label: 'Equipe do local',
      avatarUrl: 'https://example.com/avatar.webp',
      identityCode: null,
      identityLabel: 'Casal',
      identityShortLabel: 'Casal',
      discoveryGroup: 'couple',
      city: 'Rio de Janeiro',
      state: 'RJ',
      profileType: 'couple',
      profileTypeLabel: 'Casal',
    });
    expect('uid' in page.items[0].author).toBe(false);
    expect(page.items[0].metrics.reactionCount).toBe(7);
    expect(page.items[0].capabilities.canDeleteOwn).toBe(true);
    expect(page.items[0].capabilities.canReact).toBe(true);
    expect(page.items[0].capabilities.viewerReacted).toBe(false);
    expect(page.items[0].capabilities.canViewComments).toBe(true);
    expect(page.items[0].capabilities.canComment).toBe(true);
    expect(page.nextCursor).toBe('post-1');
  });

  it('normaliza localização compartilhada para precisão aproximada', () => {
    const page = normalizeCommunityFeedPageResponse({
      items: [item({
        kind: 'location',
        image: null,
        location: { latitude: -22.9068, longitude: -43.1729 },
      })],
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].kind).toBe('location');
    expect(page.items[0].location).toEqual({
      latitude: -22.91,
      longitude: -43.17,
      precision: 'approximate',
      accuracyMeters: null,
    });
  });

  it('remove URLs inseguras sem descartar texto válido', () => {
    const page = normalizeCommunityFeedPageResponse({
      items: [
        item({
          kind: 'text',
          image: null,
          author: {
            label: 'Moderação',
            avatarUrl: 'http://insecure.test/avatar.jpg',
          },
        }),
      ],
    });

    expect(page.items[0].author.avatarUrl).toBeNull();
  });

  it('aceita URL HTTP somente no loopback do Emulator', () => {
    const page = normalizeCommunityFeedPageResponse({
      items: [
        item({
          image: {
            url: 'http://127.0.0.1:9199/v0/b/demo/o/photo.webp?alt=media',
            alt: 'Foto no Emulator',
          },
        }),
      ],
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].image?.url).toContain('127.0.0.1:9199');
  });

  it('descarta foto HTTP remota e payload malformado', () => {
    const page = normalizeCommunityFeedPageResponse({
      items: [
        item({ image: { url: 'http://insecure.test/photo.jpg' } }),
        { postId: '../invalid' },
      ],
    });

    expect(page.items).toEqual([]);
  });

  it('limita contadores negativos e excessivos', () => {
    const page = normalizeCommunityFeedPageResponse({
      items: [
        item({
          metrics: {
            commentCount: -20,
            reactionCount: Number.MAX_SAFE_INTEGER,
          },
        }),
      ],
    });

    expect(page.items[0].metrics.commentCount).toBe(0);
    expect(page.items[0].metrics.reactionCount).toBe(1_000_000_000);
  });

  it('descarta datas muito futuras ou anteriores ao ano 2000', () => {
    const page = normalizeCommunityFeedPageResponse({
      items: [
        item({ publishedAt: Date.now() + 10 * 60_000 }),
        item({ postId: 'post-2', publishedAt: Date.UTC(1999, 11, 31) }),
      ],
    });

    expect(page.items).toEqual([]);
  });
});

describe('normalizeCommunityFeedReactionResponse', () => {
  it('aceita uma reação autoritativa válida', () => {
    expect(normalizeCommunityFeedReactionResponse({
      communityId: 'community-1',
      postId: 'post-1',
      reacted: true,
      reactionCount: 8,
    })).toEqual({
      communityId: 'community-1',
      postId: 'post-1',
      reacted: true,
      reactionCount: 8,
    });
  });

  it('rejeita estado ou contador de reação inválidos', () => {
    expect(() => normalizeCommunityFeedReactionResponse({
      communityId: 'community-1',
      postId: 'post-1',
      reacted: 'yes',
      reactionCount: -1,
    })).toThrow('Resposta de reação no Mural inválida.');
  });
});

describe('normalizeCommunityFeedPostActionResponse', () => {
  it('aceita exclusão autoral concluída', () => {
    expect(normalizeCommunityFeedPostActionResponse({
      communityId: 'community-1',
      postId: 'post-1',
      action: 'delete_own',
      status: 'deleted',
      deduplicated: false,
      generatedAt: 123,
    })).toEqual({
      communityId: 'community-1',
      postId: 'post-1',
      action: 'delete_own',
      status: 'deleted',
      deduplicated: false,
      generatedAt: 123,
    });
  });

  it('rejeita estado incompatível com a ação do Mural', () => {
    expect(() => normalizeCommunityFeedPostActionResponse({
      communityId: 'community-1',
      postId: 'post-1',
      action: 'remove',
      status: 'active',
      generatedAt: 123,
    })).toThrow('Resposta de ação no Mural inválida.');
  });
});

describe('normalizeCommunityFeedPostCreateResponse', () => {
  it('aceita resposta idempotente válida', () => {
    expect(normalizeCommunityFeedPostCreateResponse({
      communityId: 'community-1',
      postId: 'post-1',
      created: false,
      deduplicated: true,
    })).toEqual({
      communityId: 'community-1',
      postId: 'post-1',
      created: false,
      deduplicated: true,
    });
  });

  it('falha fechado para identificadores inválidos', () => {
    expect(() => normalizeCommunityFeedPostCreateResponse({
      communityId: '../invalid',
      postId: 'post-1',
    })).toThrow('Resposta de publicação no Mural inválida.');
  });
});

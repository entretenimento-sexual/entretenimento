import { describe, expect, it } from 'vitest';

import { normalizeCommunityFeedPageResponse } from './community-feed.model';

function item(overrides: Record<string, unknown> = {}) {
  return {
    postId: 'post-1',
    kind: 'photo',
    author: {
      label: 'Equipe do local',
      avatarUrl: 'https://example.com/avatar.webp',
    },
    text: 'Atualização do local.',
    image: {
      url: 'https://example.com/photo.webp',
      alt: 'Foto do local',
    },
    metrics: { commentCount: 2, reactionCount: 7 },
    publishedAt: 1_800_000_000_000,
    ...overrides,
  };
}

describe('normalizeCommunityFeedPageResponse', () => {
  it('normaliza itens, cursor e contadores', () => {
    const page = normalizeCommunityFeedPageResponse({
      items: [item()],
      nextCursor: 'post-1',
      generatedAt: 123,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].metrics.reactionCount).toBe(7);
    expect(page.nextCursor).toBe('post-1');
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

  it('descarta foto sem HTTPS e payload malformado', () => {
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
});

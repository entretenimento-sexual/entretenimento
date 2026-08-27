import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityTopicCreateResponse,
  normalizeCommunityTopicDetailResponse,
  normalizeCommunityTopicPageResponse,
  normalizeCommunityTopicRepliesPageResponse,
  normalizeCommunityTopicReplyCreateResponse,
} from './community-topic.model';

const now = Date.now();

function topic(overrides: Record<string, unknown> = {}) {
  return {
    topicId: 'topic-1',
    title: 'Boas práticas',
    excerpt: 'Compartilhe experiências.',
    author: { label: 'Pessoa', avatarUrl: 'https://example.com/avatar.jpg' },
    status: 'active',
    metrics: { replyCount: 2, reactionCount: 3 },
    createdAt: now - 10_000,
    lastActivityAt: now - 1_000,
    ...overrides,
  };
}

describe('community-topic.model', () => {
  it('normaliza página e descarta itens inseguros', () => {
    const page = normalizeCommunityTopicPageResponse({
      items: [
        topic(),
        topic({ topicId: '../unsafe' }),
        topic({ author: { label: 'Pessoa', avatarUrl: 'http://unsafe.test/a.jpg' } }),
      ],
      nextCursor: 'topic-2',
      generatedAt: now,
    });

    expect(page.items).toHaveLength(2);
    expect(page.items[1].author.avatarUrl).toBeNull();
    expect(page.nextCursor).toBe('topic-2');
  });

  it('normaliza detalhe e respeita canReply somente em tópico ativo', () => {
    const active = normalizeCommunityTopicDetailResponse({
      topic: {
        ...topic(),
        body: 'Texto integral do Tópico.',
      },
      canReply: true,
      generatedAt: now,
    });
    const locked = normalizeCommunityTopicDetailResponse({
      topic: {
        ...topic({ status: 'locked' }),
        body: 'Texto integral do Tópico.',
      },
      canReply: true,
      generatedAt: now,
    });

    expect(active.topic.body).toBe('Texto integral do Tópico.');
    expect(active.canReply).toBe(true);
    expect(locked.canReply).toBe(false);
  });

  it('rejeita detalhe malformado', () => {
    expect(() =>
      normalizeCommunityTopicDetailResponse({
        topic: { ...topic(), body: '' },
        generatedAt: now,
      })
    ).toThrow('Resposta de detalhe de Tópico inválida.');
  });

  it('normaliza respostas e remove projeções inválidas', () => {
    const page = normalizeCommunityTopicRepliesPageResponse({
      items: [
        {
          replyId: 'reply-1',
          body: 'Resposta válida.',
          author: { label: 'Pessoa', avatarUrl: null },
          createdAt: now - 500,
        },
        {
          replyId: 'reply/unsafe',
          body: 'Inválida.',
          author: { label: 'Pessoa' },
          createdAt: now,
        },
      ],
      nextCursor: null,
      generatedAt: now,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].replyId).toBe('reply-1');
  });

  it('normaliza respostas de escrita sem confiar em ids inválidos', () => {
    expect(
      normalizeCommunityTopicCreateResponse({
        communityId: 'community-1',
        topicId: 'topic-1',
        created: true,
        deduplicated: false,
      })
    ).toEqual({
      communityId: 'community-1',
      topicId: 'topic-1',
      created: true,
      deduplicated: false,
    });

    expect(
      normalizeCommunityTopicReplyCreateResponse({
        communityId: 'community-1',
        topicId: 'topic-1',
        replyId: 'reply-1',
        replyCount: 4,
        created: true,
        deduplicated: false,
      }).replyCount
    ).toBe(4);

    expect(() =>
      normalizeCommunityTopicCreateResponse({ communityId: '../unsafe' })
    ).toThrow();
  });
});

import { describe, expect, it } from 'vitest';

import {
  INITIAL_COMMUNITY_TOPIC_REPLIES_STATE,
  INITIAL_COMMUNITY_TOPICS_STATE,
  reduceCommunityTopicRepliesState,
  reduceCommunityTopicsState,
} from './community-topics-state.model';

const topic = {
  topicId: 'topic-1',
  title: 'Tema',
  excerpt: 'Resumo',
  author: { label: 'Pessoa', avatarUrl: null },
  status: 'active' as const,
  metrics: { replyCount: 0, reactionCount: 0 },
  createdAt: 1,
  lastActivityAt: 1,
};

const reply = {
  replyId: 'reply-1',
  body: 'Resposta',
  author: { label: 'Pessoa', avatarUrl: null },
  createdAt: 1,
};

describe('community-topics-state.model', () => {
  it('substitui primeira página e agrega páginas seguintes sem duplicar Tópicos', () => {
    const ready = reduceCommunityTopicsState(INITIAL_COMMUNITY_TOPICS_STATE, {
      type: 'success',
      request: { cursor: null, append: false },
      page: { items: [topic], nextCursor: 'topic-1', generatedAt: 1 },
    });
    const appended = reduceCommunityTopicsState(ready, {
      type: 'success',
      request: { cursor: 'topic-1', append: true },
      page: {
        items: [{ ...topic, title: 'Tema atualizado' }],
        nextCursor: null,
        generatedAt: 2,
      },
    });

    expect(appended.items).toHaveLength(1);
    expect(appended.items[0].title).toBe('Tema atualizado');
    expect(appended.loadingMore).toBe(false);
  });

  it('preserva página carregada quando paginação adicional falha', () => {
    const ready = {
      status: 'ready' as const,
      items: [topic],
      nextCursor: 'topic-1',
      loadingMore: true,
    };

    expect(
      reduceCommunityTopicsState(ready, {
        type: 'error',
        request: { cursor: 'topic-1', append: true },
      })
    ).toEqual({ ...ready, loadingMore: false });
  });

  it('agrega respostas e usa empty quando não há conteúdo', () => {
    const empty = reduceCommunityTopicRepliesState(
      INITIAL_COMMUNITY_TOPIC_REPLIES_STATE,
      {
        type: 'success',
        request: { cursor: null, append: false },
        page: { items: [], nextCursor: null, generatedAt: 1 },
      }
    );
    const ready = reduceCommunityTopicRepliesState(
      INITIAL_COMMUNITY_TOPIC_REPLIES_STATE,
      {
        type: 'success',
        request: { cursor: null, append: false },
        page: { items: [reply], nextCursor: null, generatedAt: 1 },
      }
    );

    expect(empty.status).toBe('empty');
    expect(ready.status).toBe('ready');
    expect(ready.items[0].replyId).toBe('reply-1');
  });
});

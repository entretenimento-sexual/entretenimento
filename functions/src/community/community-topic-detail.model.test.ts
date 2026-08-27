import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCommunityTopicDetailRequest,
  normalizeCommunityTopicRepliesPageRequest,
  sanitizeCommunityTopicDetail,
  sanitizeCommunityTopicReplyProjection,
} from './community-topic-detail.model';

test('normaliza detalhe e paginação de respostas com limites seguros', () => {
  assert.deepEqual(
    normalizeCommunityTopicDetailRequest({
      communityId: ' community-1 ',
      topicId: ' topic-1 ',
    }),
    {
      communityId: 'community-1',
      topicId: 'topic-1',
    }
  );

  assert.deepEqual(
    normalizeCommunityTopicRepliesPageRequest({
      communityId: 'community-1',
      topicId: 'topic-1',
      limit: 999,
      cursor: ' reply-2 ',
    }),
    {
      communityId: 'community-1',
      topicId: 'topic-1',
      limit: 40,
      cursor: 'reply-2',
    }
  );
});

test('rejeita ids inseguros no detalhe e na paginação', () => {
  assert.deepEqual(
    normalizeCommunityTopicDetailRequest({
      communityId: '../unsafe',
      topicId: 'topic/unsafe',
    }),
    {
      communityId: null,
      topicId: null,
    }
  );

  assert.equal(
    normalizeCommunityTopicRepliesPageRequest({ cursor: '../unsafe' }).cursor,
    null
  );
});

test('sanitiza detalhe ativo sem expor uid ou metadados internos', () => {
  const now = 5_000_000;
  const detail = sanitizeCommunityTopicDetail(
    'topic-1',
    {
      title: 'Tema persistente',
      body: 'Discussão completa do tópico.',
      audience: 'public_preview',
      status: 'active',
      moderationState: 'active',
      actorUid: 'private-uid',
      author: {
        uid: 'private-uid',
        label: 'Participante',
        avatarUrl: 'https://example.com/avatar.webp',
      },
      metrics: {
        replyCount: 3,
        reactionCount: 2,
      },
      createdAt: now - 10_000,
      lastActivityAt: now - 1_000,
      moderationReason: 'internal-only',
    },
    now
  );

  assert.ok(detail);
  assert.deepEqual(detail, {
    audience: 'public_preview',
    item: {
      topicId: 'topic-1',
      title: 'Tema persistente',
      body: 'Discussão completa do tópico.',
      author: {
        label: 'Participante',
        avatarUrl: 'https://example.com/avatar.webp',
      },
      status: 'active',
      metrics: {
        replyCount: 3,
        reactionCount: 2,
      },
      createdAt: now - 10_000,
      lastActivityAt: now - 1_000,
    },
  });
  assert.equal('actorUid' in detail.item, false);
  assert.equal('moderationReason' in detail.item, false);
});

test('mantém locked legível e rejeita archived ou moderação oculta', () => {
  const now = 6_000_000;
  const base = {
    title: 'Tópico válido',
    body: 'Conteúdo completo.',
    audience: 'members_only',
    moderationState: 'active',
    author: { label: 'Pessoa' },
    metrics: {},
    createdAt: now - 10_000,
    lastActivityAt: now - 1_000,
  };

  assert.equal(
    sanitizeCommunityTopicDetail(
      'topic-locked',
      { ...base, status: 'locked' },
      now
    )?.item.status,
    'locked'
  );
  assert.equal(
    sanitizeCommunityTopicDetail(
      'topic-archived',
      { ...base, status: 'archived' },
      now
    ),
    null
  );
  assert.equal(
    sanitizeCommunityTopicDetail(
      'topic-hidden',
      { ...base, status: 'active', moderationState: 'hidden' },
      now
    ),
    null
  );
});

test('sanitiza somente resposta ativa e remove identidade interna', () => {
  const now = 7_000_000;
  const reply = sanitizeCommunityTopicReplyProjection(
    'reply-1',
    {
      body: 'Resposta válida.',
      actorUid: 'private-uid',
      author: {
        uid: 'private-uid',
        label: 'Pessoa',
        avatarUrl: 'http://unsafe.example/avatar.jpg',
      },
      moderationState: 'active',
      createdAt: now - 1_000,
    },
    now
  );

  assert.deepEqual(reply, {
    replyId: 'reply-1',
    body: 'Resposta válida.',
    author: {
      label: 'Pessoa',
      avatarUrl: null,
    },
    createdAt: now - 1_000,
  });
  assert.equal(
    sanitizeCommunityTopicReplyProjection(
      'reply-hidden',
      {
        body: 'Oculta',
        author: { label: 'Pessoa' },
        moderationState: 'hidden',
        createdAt: now - 500,
      },
      now
    ),
    null
  );
});

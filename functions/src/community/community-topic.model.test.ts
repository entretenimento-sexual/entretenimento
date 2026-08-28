import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCommunityTopicCreateRequest,
  normalizeCommunityTopicPageRequest,
  normalizeCommunityTopicReplyCreateRequest,
  sanitizeCommunityTopicProjection,
} from './community-topic.model';

test('normaliza paginação de tópicos com limites seguros', () => {
  assert.deepEqual(
    normalizeCommunityTopicPageRequest({
      communityId: ' community-1 ',
      limit: 999,
      cursor: ' topic-2 ',
    }),
    {
      communityId: 'community-1',
      limit: 24,
      cursor: 'topic-2',
    }
  );

  assert.deepEqual(normalizeCommunityTopicPageRequest(undefined), {
    communityId: null,
    limit: 12,
    cursor: null,
  });
});

test('normaliza criação de tópico e usa public_preview como audiência padrão', () => {
  assert.deepEqual(
    normalizeCommunityTopicCreateRequest({
      requestId: ' request-topic-1 ',
      communityId: 'community-1',
      title: '  Um   tópico interessante  ',
      body: '  Texto   inicial  ',
    }),
    {
      requestId: 'request-topic-1',
      communityId: 'community-1',
      title: 'Um tópico interessante',
      body: 'Texto inicial',
      audience: 'public_preview',
    }
  );

  assert.equal(
    normalizeCommunityTopicCreateRequest({ audience: 'members_only' }).audience,
    'members_only'
  );
});

test('normaliza resposta com requestId idempotente', () => {
  assert.deepEqual(
    normalizeCommunityTopicReplyCreateRequest({
      requestId: ' reply-1 ',
      communityId: ' community-1 ',
      topicId: ' topic-1 ',
      body: '  Concordo   com o ponto. ',
    }),
    {
      requestId: 'reply-1',
      communityId: 'community-1',
      topicId: 'topic-1',
      body: 'Concordo com o ponto.',
    }
  );
});

test('rejeita ids, requestId, título e resposta inválidos na normalização', () => {
  const topic = normalizeCommunityTopicCreateRequest({
    requestId: '../request',
    communityId: '../unsafe',
    title: 'x',
    body: '',
  });
  const reply = normalizeCommunityTopicReplyCreateRequest({
    requestId: 'reply/unsafe',
    communityId: 'community-1',
    topicId: 'topic/unsafe',
    body: '   ',
  });

  assert.equal(topic.requestId, null);
  assert.equal(topic.communityId, null);
  assert.equal(topic.title, null);
  assert.equal(topic.body, null);
  assert.equal(reply.requestId, null);
  assert.equal(reply.communityId, 'community-1');
  assert.equal(reply.topicId, null);
  assert.equal(reply.body, null);
});

test('sanitiza projeção ativa sem expor uid ou metadados internos', () => {
  const now = 2_000_000;
  const projection = sanitizeCommunityTopicProjection(
    'topic-1',
    {
      title: 'Boas práticas da comunidade',
      excerpt: 'Compartilhe experiências e dúvidas.',
      audience: 'public_preview',
      status: 'active',
      moderationState: 'active',
      author: {
        uid: 'private-uid',
        label: 'Pessoa',
        avatarUrl: 'https://example.com/avatar.jpg',
      },
      metrics: {
        replyCount: 4,
        reactionCount: 7,
      },
      createdAt: now - 5_000,
      lastActivityAt: now - 1_000,
      moderationReason: 'internal-only',
    },
    now
  );

  assert.ok(projection);
  assert.deepEqual(projection, {
    audience: 'public_preview',
    item: {
      topicId: 'topic-1',
      title: 'Boas práticas da comunidade',
      excerpt: 'Compartilhe experiências e dúvidas.',
      author: {
        label: 'Pessoa',
        avatarUrl: 'https://example.com/avatar.jpg',
      },
      status: 'active',
      metrics: {
        replyCount: 4,
        reactionCount: 7,
      },
      createdAt: now - 5_000,
      lastActivityAt: now - 1_000,
    },
  });
  assert.equal('uid' in projection.item.author, false);
  assert.equal('moderationReason' in projection.item, false);
});

test('mantém tópico locked legível, mas exclui archived e moderação não ativa', () => {
  const now = 3_000_000;
  const base = {
    title: 'Tópico válido',
    excerpt: 'Resumo',
    audience: 'members_only',
    moderationState: 'active',
    author: { label: 'Pessoa' },
    metrics: {},
    createdAt: now - 10_000,
    lastActivityAt: now - 5_000,
  };

  assert.equal(
    sanitizeCommunityTopicProjection(
      'topic-locked',
      { ...base, status: 'locked' },
      now
    )?.item.status,
    'locked'
  );
  assert.equal(
    sanitizeCommunityTopicProjection(
      'topic-archived',
      { ...base, status: 'archived' },
      now
    ),
    null
  );
  assert.equal(
    sanitizeCommunityTopicProjection(
      'topic-hidden',
      { ...base, status: 'active', moderationState: 'hidden' },
      now
    ),
    null
  );
});

test('rejeita projeção com atividade anterior à criação ou timestamps futuros', () => {
  const now = 4_000_000;
  const base = {
    title: 'Tópico válido',
    excerpt: 'Resumo',
    audience: 'public_preview',
    status: 'active',
    moderationState: 'active',
    author: { label: 'Pessoa' },
    metrics: {},
  };

  assert.equal(
    sanitizeCommunityTopicProjection(
      'topic-1',
      {
        ...base,
        createdAt: now - 1_000,
        lastActivityAt: now - 2_000,
      },
      now
    ),
    null
  );
  assert.equal(
    sanitizeCommunityTopicProjection(
      'topic-2',
      {
        ...base,
        createdAt: now,
        lastActivityAt: now + 6 * 60_000,
      },
      now
    ),
    null
  );
});

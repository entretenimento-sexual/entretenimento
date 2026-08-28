import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCommunityFeedCommentActionRequest,
  normalizeCommunityFeedCommentCreateRequest,
  normalizeCommunityFeedCommentPageRequest,
  normalizeCommunityFeedCommentReplyActionRequest,
  normalizeCommunityFeedCommentReplyCreateRequest,
  normalizeCommunityFeedCommentReplyPageRequest,
  sanitizeCommunityFeedComment,
  sanitizeCommunityFeedCommentReply,
} from './community-feed-comment.model';

const NOW = 1_800_000_000_000;

test('normaliza criação, paginação e ação de comentário', () => {
  assert.deepEqual(normalizeCommunityFeedCommentPageRequest({
    communityId: 'community-1',
    postId: 'post-1',
    limit: 999,
    cursor: 'comment-1',
  }), {
    communityId: 'community-1',
    postId: 'post-1',
    limit: 30,
    cursor: 'comment-1',
  });
  assert.deepEqual(normalizeCommunityFeedCommentCreateRequest({
    requestId: 'request-1',
    communityId: 'community-1',
    postId: 'post-1',
    text: '  Comentário\nseguro. ',
  }), {
    requestId: 'request-1',
    communityId: 'community-1',
    postId: 'post-1',
    text: 'Comentário seguro.',
    textTooLong: false,
  });
  assert.equal(normalizeCommunityFeedCommentActionRequest({
    requestId: 'request-2',
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    action: 'remove',
    reason: ' Fora das regras. ',
  }).reason, 'Fora das regras.');
});

test('normaliza paginação, criação e ação de resposta rasa', () => {
  assert.deepEqual(normalizeCommunityFeedCommentReplyPageRequest({
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    limit: 999,
    cursor: 'reply-1',
  }), {
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    limit: 24,
    cursor: 'reply-1',
  });

  assert.deepEqual(normalizeCommunityFeedCommentReplyCreateRequest({
    requestId: 'reply-request-1',
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    text: '  Resposta\nsegura. ',
  }), {
    requestId: 'reply-request-1',
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    text: 'Resposta segura.',
    textTooLong: false,
  });

  assert.deepEqual(normalizeCommunityFeedCommentReplyActionRequest({
    requestId: 'reply-action-1',
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    replyId: 'reply-1',
    action: 'remove',
    reason: ' Fora das regras. ',
  }), {
    requestId: 'reply-action-1',
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    replyId: 'reply-1',
    action: 'remove',
    reason: 'Fora das regras.',
    reasonTooLong: false,
  });
});

test('sanitiza comentário sem expor UID no item público', () => {
  const sanitized = sanitizeCommunityFeedComment('comment-1', {
    actorUid: 'member-1',
    author: { label: 'Participante', avatarUrl: 'http://unsafe.test/a.jpg' },
    text: 'Comentário visível.',
    metrics: { replyCount: 3 },
    status: 'active',
    moderationState: 'active',
    createdAt: NOW,
  }, NOW);

  assert.equal(sanitized?.actorUid, 'member-1');
  assert.equal(sanitized?.item.author.avatarUrl, null);
  assert.equal(sanitized?.item.replyCount, 3);
  assert.equal('actorUid' in (sanitized?.item ?? {}), false);
});

test('sanitiza resposta vinculada somente ao comentário esperado', () => {
  const reply = sanitizeCommunityFeedCommentReply('reply-1', {
    actorUid: 'member-2',
    commentId: 'comment-1',
    author: { label: 'Outra pessoa', avatarUrl: 'https://example.com/a.webp' },
    text: 'Uma resposta.',
    status: 'active',
    moderationState: 'active',
    createdAt: NOW,
  }, 'comment-1', NOW);

  assert.equal(reply?.actorUid, 'member-2');
  assert.equal(reply?.item.replyId, 'reply-1');
  assert.equal(reply?.item.author.avatarUrl, 'https://example.com/a.webp');
  assert.equal('actorUid' in (reply?.item ?? {}), false);

  assert.equal(sanitizeCommunityFeedCommentReply('reply-1', {
    actorUid: 'member-2',
    commentId: 'other-comment',
    author: { label: 'Outra pessoa' },
    text: 'Resposta deslocada.',
    status: 'active',
    moderationState: 'active',
    createdAt: NOW,
  }, 'comment-1', NOW), null);
});

test('rejeita IDs, excesso, conteúdo oculto e timestamps futuros', () => {
  assert.equal(normalizeCommunityFeedCommentCreateRequest({
    requestId: '../unsafe',
    text: 'x'.repeat(501),
  }).textTooLong, true);
  assert.equal(normalizeCommunityFeedCommentReplyCreateRequest({
    requestId: '../unsafe',
    text: 'x'.repeat(501),
  }).textTooLong, true);
  assert.equal(sanitizeCommunityFeedComment('comment-1', {
    actorUid: 'member-1',
    author: { label: 'Participante' },
    text: 'Oculto',
    status: 'removed',
    moderationState: 'removed',
    createdAt: NOW,
  }, NOW), null);
  assert.equal(sanitizeCommunityFeedComment('comment-1', {
    actorUid: 'member-1',
    author: { label: 'Participante' },
    text: 'Futuro',
    status: 'active',
    moderationState: 'active',
    createdAt: NOW + 10 * 60_000,
  }, NOW), null);
});

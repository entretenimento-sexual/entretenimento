import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCommunityFeedCommentReplyReportRequest,
  normalizeCommunityFeedCommentReportRequest,
  normalizeCommunityFeedReportRequest,
} from './community-feed-report.model';

test('normaliza denúncia do Mural e limita detalhes e rota', () => {
  assert.deepEqual(normalizeCommunityFeedReportRequest({
    communityId: 'community-1',
    postId: 'post-1',
    reason: 'harassment',
    details: '  Ameaça repetida.  ',
    route: ' /comunidades/community-1 ',
  }), {
    communityId: 'community-1',
    postId: 'post-1',
    reason: 'harassment',
    details: 'Ameaça repetida.',
    route: '/comunidades/community-1',
  });
});

test('normaliza denúncia de comentário com três referências seguras', () => {
  assert.deepEqual(normalizeCommunityFeedCommentReportRequest({
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    reason: 'privacy',
  }), {
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    reason: 'privacy',
    details: null,
    route: null,
  });
});

test('normaliza denúncia de resposta preservando toda a ancestralidade', () => {
  assert.deepEqual(normalizeCommunityFeedCommentReplyReportRequest({
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    replyId: 'reply-1',
    reason: 'harassment',
  }), {
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    replyId: 'reply-1',
    reason: 'harassment',
    details: null,
    route: null,
  });
});

test('rejeita alvo e motivo fora do contrato', () => {
  const normalized = normalizeCommunityFeedReportRequest({
    communityId: '../unsafe',
    postId: 'post-1',
    reason: 'not-a-reason',
  });

  assert.equal(normalized.communityId, null);
  assert.equal(normalized.reason, null);

  assert.equal(normalizeCommunityFeedCommentReplyReportRequest({
    communityId: 'community-1',
    postId: 'post-1',
    commentId: 'comment-1',
    replyId: '../unsafe',
    reason: 'privacy',
  }).replyId, null);
});

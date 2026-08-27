import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCommunityFeedPostActionRequest } from './community-feed-moderation.model';

test('normaliza exclusão autoral e descarta motivo desnecessário vazio', () => {
  assert.deepEqual(normalizeCommunityFeedPostActionRequest({
    requestId: 'action-1',
    communityId: 'community-1',
    postId: 'post-1',
    action: 'delete_own',
    reason: '  ',
  }), {
    requestId: 'action-1',
    communityId: 'community-1',
    postId: 'post-1',
    action: 'delete_own',
    reason: null,
    reasonTooLong: false,
  });
});

test('preserva motivo sanitizado e sinaliza excesso', () => {
  const normalized = normalizeCommunityFeedPostActionRequest({
    requestId: 'action-2',
    communityId: 'community-1',
    postId: 'post-1',
    action: 'remove',
    reason: `  ${'a'.repeat(241)}  `,
  });

  assert.equal(normalized.action, 'remove');
  assert.equal(normalized.reason?.length, 241);
  assert.equal(normalized.reasonTooLong, true);
});

test('falha fechado para IDs e ação inválidos', () => {
  const normalized = normalizeCommunityFeedPostActionRequest({
    requestId: '../unsafe',
    communityId: 'community-1',
    postId: 'post-1',
    action: 'publish',
  });

  assert.equal(normalized.requestId, null);
  assert.equal(normalized.action, null);
});

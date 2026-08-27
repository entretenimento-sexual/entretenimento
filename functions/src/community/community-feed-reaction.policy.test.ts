import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCommunityFeedReaction } from './community-feed-reaction.policy';

const base = {
  sourceType: 'community',
  memberActivityAllowed: true,
  membershipStatus: 'active',
  viewerRole: 'member' as const,
  postStatus: 'active',
  postModerationState: 'active',
};

test('membro ativo pode reagir a publicação do Mural', () => {
  assert.deepEqual(evaluateCommunityFeedReaction(base), {
    allowed: true,
    denialReason: null,
  });
});

test('a autoria da publicação não restringe a reação do membro ativo', () => {
  assert.deepEqual(evaluateCommunityFeedReaction(base), {
    allowed: true,
    denialReason: null,
  });
});

test('nega visitante, lifecycle fechado e publicação removida', () => {
  assert.equal(evaluateCommunityFeedReaction({
    ...base,
    membershipStatus: null,
    viewerRole: null,
  }).denialReason, 'active_membership_required');
  assert.equal(evaluateCommunityFeedReaction({
    ...base,
    memberActivityAllowed: false,
  }).denialReason, 'community_unavailable');
  assert.equal(evaluateCommunityFeedReaction({
    ...base,
    postStatus: 'removed',
  }).denialReason, 'post_unavailable');
});

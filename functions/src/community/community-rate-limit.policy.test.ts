// functions/src/community/community-rate-limit.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type CommunityRateLimitAction,
  getCommunityRateLimitPolicy,
} from './community-rate-limit.policy';

const ACTIONS: readonly CommunityRateLimitAction[] = [
  'feed_post',
  'feed_conversation',
  'feed_reaction',
  'feed_report_post',
  'feed_report_comment',
  'feed_report_reply',
  'invite_send',
  'membership_request',
  'member_management',
];

test('todas as mutações cobertas possuem política válida e ação backend estável', () => {
  for (const action of ACTIONS) {
    const policy = getCommunityRateLimitPolicy(action);

    assert.equal(Boolean(policy.backendAction), true);
    assert.equal(Boolean(policy.reason), true);
    assert.equal(Boolean(policy.message), true);
    assert.equal(policy.config.burstWindowMs > 0, true);
    assert.equal(policy.config.burstMax > 0, true);
    assert.equal(policy.config.sustainedWindowMs >= policy.config.burstWindowMs, true);
    assert.equal(policy.config.sustainedMax >= policy.config.burstMax, true);
  }
});

test('preserva identificadores e limites já usados por conversa e reação', () => {
  assert.deepEqual(getCommunityRateLimitPolicy('feed_conversation'), {
    backendAction: 'createCommunityFeedComment',
    config: {
      burstWindowMs: 60_000,
      burstMax: 12,
      sustainedWindowMs: 600_000,
      sustainedMax: 60,
    },
    reason: 'community_feed_conversation_rate_limited',
    message: 'Muitas mensagens foram enviadas em pouco tempo.',
  });

  assert.deepEqual(getCommunityRateLimitPolicy('feed_reaction'), {
    backendAction: 'toggleCommunityFeedReaction',
    config: {
      burstWindowMs: 60_000,
      burstMax: 40,
      sustainedWindowMs: 600_000,
      sustainedMax: 180,
    },
    reason: 'community_feed_reaction_rate_limited',
    message: 'Muitas reações foram enviadas em pouco tempo.',
  });
});

test('convites e entrada limitam abuso global por ator em janela horária', () => {
  const invite = getCommunityRateLimitPolicy('invite_send');
  const membership = getCommunityRateLimitPolicy('membership_request');

  assert.equal(invite.backendAction, 'sendCommunityInvite');
  assert.equal(invite.config.sustainedWindowMs, 3_600_000);
  assert.equal(invite.config.sustainedMax, 24);
  assert.equal(membership.backendAction, 'requestCommunityMembership');
  assert.equal(membership.config.sustainedWindowMs, 3_600_000);
  assert.equal(membership.config.sustainedMax, 20);
});

test('gestão permite operação legítima em lote sem deixar a ação ilimitada', () => {
  const management = getCommunityRateLimitPolicy('member_management');

  assert.equal(management.backendAction, 'manageCommunityMember');
  assert.equal(management.config.burstMax, 20);
  assert.equal(management.config.sustainedMax, 100);
});

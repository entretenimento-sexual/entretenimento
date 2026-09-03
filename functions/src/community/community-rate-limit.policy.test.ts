// functions/src/community/community-rate-limit.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type CommunityRateLimitAction,
  getCommunityRateLimitPolicy,
} from './community-rate-limit.policy';

const ACTIONS: readonly CommunityRateLimitAction[] = [
  'community_create',
  'official_space_create',
  'feed_post',
  'feed_conversation',
  'topic_conversation',
  'feed_reaction',
  'feed_report_post',
  'feed_report_comment',
  'feed_report_reply',
  'invite_send',
  'membership_request',
  'membership_review',
  'member_management',
  'highlight_management',
  'settings_update',
  'ownership_mutation',
  'content_moderation',
  'operations_ranking',
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

test('criações pessoais e oficiais possuem orçamentos independentes e restritos', () => {
  const personal = getCommunityRateLimitPolicy('community_create');
  const official = getCommunityRateLimitPolicy('official_space_create');

  assert.equal(personal.backendAction, 'createCommunity');
  assert.equal(personal.config.burstMax, 3);
  assert.equal(personal.config.sustainedWindowMs, 3_600_000);
  assert.equal(personal.config.sustainedMax, 10);
  assert.equal(personal.reason, 'community_creation_rate_limited');

  assert.equal(official.backendAction, 'createVenueCommunity');
  assert.equal(official.config.burstMax, 2);
  assert.equal(official.config.sustainedWindowMs, 3_600_000);
  assert.equal(official.config.sustainedMax, 6);
  assert.equal(official.reason, 'official_space_creation_rate_limited');
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

test('tópicos e respostas compartilham orçamento operacional sem substituir a quota de 24h', () => {
  assert.deepEqual(getCommunityRateLimitPolicy('topic_conversation'), {
    backendAction: 'communityTopicConversation',
    config: {
      burstWindowMs: 60_000,
      burstMax: 12,
      sustainedWindowMs: 600_000,
      sustainedMax: 60,
    },
    reason: 'community_topic_rate_limited',
    message: 'Muitas interações em Tópicos foram realizadas em pouco tempo.',
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
  const review = getCommunityRateLimitPolicy('membership_review');
  const highlight = getCommunityRateLimitPolicy('highlight_management');
  const moderation = getCommunityRateLimitPolicy('content_moderation');

  assert.equal(management.backendAction, 'manageCommunityMember');
  assert.equal(management.config.burstMax, 20);
  assert.equal(management.config.sustainedMax, 100);
  assert.equal(review.config.sustainedMax, 100);
  assert.equal(highlight.backendAction, 'manageCommunityHighlight');
  assert.equal(highlight.config.burstMax, 10);
  assert.equal(highlight.config.sustainedMax, 40);
  assert.equal(highlight.reason, 'community_management_rate_limited');
  assert.equal(moderation.backendAction, 'communityContentModeration');
  assert.equal(moderation.config.sustainedMax, 180);
});

test('ações sensíveis de configuração, propriedade e ranking permanecem restritas', () => {
  const settings = getCommunityRateLimitPolicy('settings_update');
  const ownership = getCommunityRateLimitPolicy('ownership_mutation');
  const ranking = getCommunityRateLimitPolicy('operations_ranking');

  assert.equal(settings.backendAction, 'updateCommunitySettings');
  assert.equal(settings.config.burstMax, 10);
  assert.equal(settings.config.sustainedMax, 40);
  assert.equal(ownership.backendAction, 'communityOwnershipMutation');
  assert.equal(ownership.config.burstMax, 6);
  assert.equal(ownership.config.sustainedMax, 20);
  assert.equal(ranking.backendAction, 'configureCommunityRankingMode');
  assert.equal(ranking.config.burstMax, 4);
  assert.equal(ranking.config.sustainedMax, 12);
  assert.equal(ranking.reason, 'community_operations_rate_limited');
});

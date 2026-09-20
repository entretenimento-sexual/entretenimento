import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type CommunityRateLimitAction,
  getCommunityRateLimitPolicy,
} from './community-rate-limit.policy';

const ACTION_COVERAGE = {
  community_create: true,
  official_space_create: true,
  official_community_create: true,
  feed_post: true,
  feed_conversation: true,
  topic_conversation: true,
  feed_reaction: true,
  feed_report_post: true,
  feed_report_comment: true,
  feed_report_reply: true,
  invite_send: true,
  membership_request: true,
  membership_leave: true,
  membership_review: true,
  member_management: true,
  highlight_management: true,
  settings_update: true,
  notification_preference_update: true,
  ownership_mutation: true,
  content_moderation: true,
  operations_ranking: true,
  operations_reconciliation: true,
} as const satisfies Readonly<Record<CommunityRateLimitAction, true>>;

const ACTIONS = Object.keys(ACTION_COVERAGE) as CommunityRateLimitAction[];

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

test('criações pessoais, espaços e comunidades oficiais possuem orçamentos independentes e restritos', () => {
  const personal = getCommunityRateLimitPolicy('community_create');
  const officialSpace = getCommunityRateLimitPolicy('official_space_create');
  const officialCommunity = getCommunityRateLimitPolicy('official_community_create');

  assert.equal(personal.backendAction, 'createCommunity');
  assert.equal(personal.config.burstMax, 3);
  assert.equal(personal.config.sustainedWindowMs, 3_600_000);
  assert.equal(personal.config.sustainedMax, 10);
  assert.equal(personal.reason, 'community_creation_rate_limited');

  assert.equal(officialSpace.backendAction, 'createVenueCommunity');
  assert.equal(officialSpace.config.burstMax, 2);
  assert.equal(officialSpace.config.sustainedWindowMs, 3_600_000);
  assert.equal(officialSpace.config.sustainedMax, 6);
  assert.equal(officialSpace.reason, 'official_space_creation_rate_limited');

  assert.equal(officialCommunity.backendAction, 'createOfficialCommunity');
  assert.equal(officialCommunity.config.burstMax, 2);
  assert.equal(officialCommunity.config.sustainedWindowMs, 3_600_000);
  assert.equal(officialCommunity.config.sustainedMax, 6);
  assert.equal(
    officialCommunity.reason,
    'official_community_creation_rate_limited'
  );
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
  assert.equal(invite.message, 'Muitas ações com convites foram realizadas em pouco tempo.');
  assert.equal(membership.backendAction, 'requestCommunityMembership');
  assert.equal(membership.config.sustainedWindowMs, 3_600_000);
  assert.equal(membership.config.sustainedMax, 20);
});

test('saída voluntária possui orçamento próprio e não compete com entrada', () => {
  const leave = getCommunityRateLimitPolicy('membership_leave');
  const request = getCommunityRateLimitPolicy('membership_request');

  assert.equal(leave.backendAction, 'leaveCommunityMembership');
  assert.equal(leave.config.burstMax, 12);
  assert.equal(leave.config.sustainedWindowMs, 3_600_000);
  assert.equal(leave.config.sustainedMax, 60);
  assert.equal(leave.reason, 'community_membership_leave_rate_limited');
  assert.notEqual(leave.backendAction, request.backendAction);
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

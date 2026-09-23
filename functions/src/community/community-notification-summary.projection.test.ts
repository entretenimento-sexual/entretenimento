import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_NOTIFICATION_SUMMARY_MATRIX,
  isCommunitySocialNotificationType,
  normalizeCommunityNotificationSummaryCount,
  projectCommunityNotificationSummaryContribution,
  sameCommunityNotificationSummaryContribution,
} from './community-notification-summary.projection';

const ALL_COMMUNITY_NOTIFICATION_TYPES = [
  'community.comment.received',
  'community.comment.reply.received',
  'community.post.reply.received',
  'community.post.reaction.received',
  'community.membership.approved',
  'community.membership.rejected',
  'community.membership.requested',
  'community.membership.removed',
  'community.membership.blocked',
  'community.membership.unblocked',
  'community.invite.accepted',
  'community.invite.declined',
  'community.content.moderated',
  'community.ownership.transfer_requested',
  'community.ownership.transfer_accepted',
  'community.ownership.transfer_declined',
  'community.ownership.transfer_canceled',
  'community.ownership.transfer_expired',
  'community.ownership.succession_archived',
] as const;

test('matriz agregada cobre todos os tipos canônicos atuais de Comunidades', () => {
  assert.deepEqual(
    Object.keys(COMMUNITY_NOTIFICATION_SUMMARY_MATRIX).sort(),
    [...ALL_COMMUNITY_NOTIFICATION_TYPES].sort()
  );

  for (const type of ALL_COMMUNITY_NOTIFICATION_TYPES) {
    const contribution = projectCommunityNotificationSummaryContribution({
      userId: 'user-1',
      communityId: 'community-1',
      type,
      readAt: null,
    });

    assert.ok(contribution, `tipo sem projeção agregada: ${type}`);
  }
});

test('somente atividade social depende do ciclo ativo de membership', () => {
  for (const type of ALL_COMMUNITY_NOTIFICATION_TYPES) {
    assert.equal(
      isCommunitySocialNotificationType(type),
      type === 'community.comment.received'
        || type === 'community.comment.reply.received'
        || type === 'community.post.reply.received'
        || type === 'community.post.reaction.received'
    );
  }
});

test('matriz prioriza gestão, perda de acesso e moderação', () => {
  const priorityTypes = new Set([
    'community.membership.requested',
    'community.membership.removed',
    'community.membership.blocked',
    'community.content.moderated',
    'community.ownership.transfer_requested',
    'community.ownership.transfer_expired',
    'community.ownership.succession_archived',
  ]);

  for (const type of ALL_COMMUNITY_NOTIFICATION_TYPES) {
    const contribution = projectCommunityNotificationSummaryContribution({
      userId: 'user-1',
      communityId: 'community-1',
      type,
      readAt: null,
    });

    assert.equal(
      contribution?.priorityUnreadCount,
      priorityTypes.has(type) ? 1 : 0,
      `prioridade inesperada para ${type}`
    );
  }
});

test('actionRequired eleva qualquer atividade comunitária a prioridade', () => {
  assert.deepEqual(projectCommunityNotificationSummaryContribution({
    userId: 'user-1',
    communityId: 'community-1',
    type: 'community.membership.approved',
    actionRequired: true,
    activityCount: 2,
    readAt: null,
  }), {
    userId: 'user-1',
    communityId: 'community-1',
    unreadCount: 2,
    priorityUnreadCount: 2,
  });
});

test('notificação lida ou fora de Comunidades não contribui', () => {
  assert.equal(projectCommunityNotificationSummaryContribution({
    userId: 'user-1',
    communityId: 'community-1',
    type: 'community.comment.reply.received',
    activityCount: 2,
    readAt: { seconds: 1 },
  }), null);

  assert.equal(projectCommunityNotificationSummaryContribution({
    userId: 'user-1',
    communityId: 'community-1',
    type: 'chat',
    readAt: null,
  }), null);
});

test('normaliza contagens corrompidas sem aceitar valor negativo', () => {
  assert.equal(normalizeCommunityNotificationSummaryCount(-3), 0);
  assert.equal(normalizeCommunityNotificationSummaryCount('7'), 7);
  assert.equal(normalizeCommunityNotificationSummaryCount(Number.NaN), 0);
});

test('compara contribuição aplicada com a desejada de forma estrita', () => {
  const contribution = {
    userId: 'user-1',
    communityId: 'community-1',
    unreadCount: 3,
    priorityUnreadCount: 0,
  };

  assert.equal(
    sameCommunityNotificationSummaryContribution(contribution, { ...contribution }),
    true
  );
  assert.equal(
    sameCommunityNotificationSummaryContribution(contribution, {
      ...contribution,
      unreadCount: 4,
    }),
    false
  );
  assert.equal(sameCommunityNotificationSummaryContribution(null, null), true);
});

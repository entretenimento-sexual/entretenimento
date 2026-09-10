import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCommunityNotificationSummaryCount,
  projectCommunityNotificationSummaryContribution,
  sameCommunityNotificationSummaryContribution,
} from './community-notification-summary.projection';

test('projeta atividade agrupada não lida por Comunidade', () => {
  assert.deepEqual(projectCommunityNotificationSummaryContribution({
    userId: 'user-1',
    communityId: 'community-1',
    type: 'community.comment.received',
    activityCount: 4,
    readAt: null,
  }), {
    userId: 'user-1',
    communityId: 'community-1',
    unreadCount: 4,
    priorityUnreadCount: 0,
  });
});

test('moderação não lida é atividade prioritária', () => {
  assert.deepEqual(projectCommunityNotificationSummaryContribution({
    userId: 'user-1',
    communityId: 'community-1',
    type: 'community.content.moderated',
    readAt: null,
  }), {
    userId: 'user-1',
    communityId: 'community-1',
    unreadCount: 1,
    priorityUnreadCount: 1,
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

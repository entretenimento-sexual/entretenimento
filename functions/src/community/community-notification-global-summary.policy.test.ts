import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_NOTIFICATION_GLOBAL_SUMMARY_VERSION,
  buildCommunityNotificationAttentionRank,
  buildCommunityNotificationAttentionWindow,
  buildCommunityNotificationGlobalProjection,
  buildCommunityNotificationSummaryItem,
} from './community-notification-global-summary.policy';

function item(
  communityId: string,
  unreadCount: number,
  priorityUnreadCount: number,
  updatedAtMs: number
) {
  const result = buildCommunityNotificationSummaryItem({
    communityId,
    unreadCount,
    priorityUnreadCount,
    updatedAtMs,
  });
  assert.ok(result);
  return result;
}

test('prioridade sempre vence recência comum na janela de atenção', () => {
  const normal = item('normal', 10, 0, 1_900_000_000_000);
  const priority = item('priority', 1, 1, 1_700_000_000_000);

  assert.ok(priority.attentionRank > normal.attentionRank);
  assert.deepEqual(
    buildCommunityNotificationAttentionWindow({
      candidates: [normal, priority],
      changes: [],
    }).map((entry) => entry.communityId),
    ['priority', 'normal']
  );
});

test('mudança substitui candidato sem varrer toda a coleção', () => {
  const oldTop = item('a', 4, 4, 100);
  const fallback = item('b', 3, 0, 90);
  const changed = item('a', 2, 0, 110);

  assert.deepEqual(
    buildCommunityNotificationAttentionWindow({
      candidates: [oldTop, fallback],
      changes: [{ before: oldTop, after: changed }],
    }).map((entry) => entry.communityId),
    ['a', 'b']
  );
});

test('global versão 2 aplica deltas exatos de total e presença', () => {
  const before = item('a', 5, 2, 100);
  const after = item('a', 3, 0, 200);

  const result = buildCommunityNotificationGlobalProjection({
    rawGlobal: {
      projectionVersion: COMMUNITY_NOTIFICATION_GLOBAL_SUMMARY_VERSION,
      unreadCount: 12,
      priorityUnreadCount: 4,
      unreadCommunityCount: 3,
      priorityCommunityCount: 2,
    },
    candidates: [before],
    changes: [{ before, after }],
    updatedAtMs: 200,
  });

  assert.equal(result.projectionVersion, 2);
  assert.equal(result.requiresBackfill, false);
  assert.equal(result.unreadCount, 10);
  assert.equal(result.priorityUnreadCount, 2);
  assert.equal(result.unreadCommunityCount, 3);
  assert.equal(result.priorityCommunityCount, 1);
  assert.equal(result.hasPriorityUnread, true);
});

test('documento ainda não migrado nunca se anuncia como versão canônica', () => {
  const after = item('a', 2, 0, 200);
  const result = buildCommunityNotificationGlobalProjection({
    rawGlobal: null,
    candidates: [],
    changes: [{ before: null, after }],
    updatedAtMs: 200,
  });

  assert.equal(result.projectionVersion, 1);
  assert.equal(result.requiresBackfill, true);
  assert.equal(result.unreadCount, 2);
});

test('rank usa faixa segura e mantém ordenação temporal dentro do mesmo tier', () => {
  assert.ok(
    buildCommunityNotificationAttentionRank({
      priorityUnreadCount: 1,
      updatedAtMs: 100,
    })
    > buildCommunityNotificationAttentionRank({
      priorityUnreadCount: 0,
      updatedAtMs: 999_999,
    })
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MARK_ALL_NOTIFICATIONS_BATCH_SIZE,
  MARK_ALL_NOTIFICATIONS_MAX_BATCHES,
  resolveMarkAllNotificationsReadBatchPlan,
  shouldResetGroupedCommunityActivityCount,
} from './read-status.policy';

test('zera o acumulador somente para atividade agrupada de Comunidade', () => {
  assert.equal(
    shouldResetGroupedCommunityActivityCount('community.comment.received'),
    true
  );
  assert.equal(
    shouldResetGroupedCommunityActivityCount('community.comment.reply.received'),
    true
  );
  assert.equal(
    shouldResetGroupedCommunityActivityCount('community.content.moderated'),
    false
  );
  assert.equal(shouldResetGroupedCommunityActivityCount('system'), false);
  assert.equal(shouldResetGroupedCommunityActivityCount(undefined), false);
});

test('encerra mark-all quando o lote cabe integralmente no limite', () => {
  assert.deepEqual(
    resolveMarkAllNotificationsReadBatchPlan({
      fetchedCount: MARK_ALL_NOTIFICATIONS_BATCH_SIZE,
      batchNumber: 1,
    }),
    {
      writeCount: MARK_ALL_NOTIFICATIONS_BATCH_SIZE,
      hasMore: false,
      shouldContinue: false,
    }
  );
});

test('continua mark-all quando o documento sentinela confirma pendências', () => {
  assert.deepEqual(
    resolveMarkAllNotificationsReadBatchPlan({
      fetchedCount: MARK_ALL_NOTIFICATIONS_BATCH_SIZE + 1,
      batchNumber: 1,
    }),
    {
      writeCount: MARK_ALL_NOTIFICATIONS_BATCH_SIZE,
      hasMore: true,
      shouldContinue: true,
    }
  );
});

test('fail-closed no teto de segurança sem declarar conclusão total', () => {
  assert.deepEqual(
    resolveMarkAllNotificationsReadBatchPlan({
      fetchedCount: MARK_ALL_NOTIFICATIONS_BATCH_SIZE + 1,
      batchNumber: MARK_ALL_NOTIFICATIONS_MAX_BATCHES,
    }),
    {
      writeCount: MARK_ALL_NOTIFICATIONS_BATCH_SIZE,
      hasMore: true,
      shouldContinue: false,
    }
  );
});

test('normaliza contagens inválidas sem produzir escrita', () => {
  assert.deepEqual(
    resolveMarkAllNotificationsReadBatchPlan({
      fetchedCount: Number.NaN,
      batchNumber: 0,
    }),
    {
      writeCount: 0,
      hasMore: false,
      shouldContinue: false,
    }
  );
});

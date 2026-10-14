import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancellationCycleNeedsAttention,
  summarizeCancellationCycle,
} from './video-cancellation-observability.policy';
import type { VideoCancellationResult } from './video-cancellation-execution';

const resolved = (status: VideoCancellationResult['status']) =>
  ({ status: 'fulfilled' as const, value: { status } as VideoCancellationResult });

test('cycle reports all results and skips without exposing any job identity', () => {
  const outcomes: PromiseSettledResult<VideoCancellationResult>[] = [
    resolved('COMPLETED'),
    resolved('RETRY_SCHEDULED'),
    resolved('UNCONFIRMED'),
    resolved('REPLACED'),
    { status: 'rejected', reason: { privateOwner: 'secret-uid' } },
  ];
  const metrics = summarizeCancellationCycle(8, 5, 2, 20, outcomes, 121.7);

  assert.deepEqual(metrics, {
    selected: 8,
    claimed: 5,
    invalid: 2,
    claimSkipped: 1,
    batchLimitReached: false,
    completed: 1,
    retryScheduled: 1,
    unconfirmed: 1,
    replaced: 1,
    taskRejected: 1,
    durationMs: 121,
  });
  assert.equal(cancellationCycleNeedsAttention(metrics), true);
  assert.ok(!JSON.stringify(metrics).includes('secret-uid'));
});

test('empty cycles report healthy zeroes with no external side effects', () => {
  const metrics = summarizeCancellationCycle(0, 0, 0, 20, [], 1);
  assert.equal(metrics.completed, 0);
  assert.equal(metrics.taskRejected, 0);
  assert.equal(metrics.claimSkipped, 0);
  assert.equal(metrics.batchLimitReached, false);
  assert.equal(cancellationCycleNeedsAttention(metrics), false);
});

test('batch saturation is informational and not proof of failure', () => {
  const metrics = summarizeCancellationCycle(20, 20, 0, 20,
    Array.from({ length: 20 }, () => resolved('COMPLETED')), 99);
  assert.equal(metrics.batchLimitReached, true);
  assert.equal(metrics.completed, 20);
  assert.equal(cancellationCycleNeedsAttention(metrics), false);
});

test('duration and skipped counts remain non-negative', () => {
  const metrics = summarizeCancellationCycle(1, 5, 0, 20, [], -11);
  assert.equal(metrics.claimSkipped, 0);
  assert.equal(metrics.durationMs, 0);
});

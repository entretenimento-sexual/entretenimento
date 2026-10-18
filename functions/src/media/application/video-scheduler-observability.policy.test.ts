import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  diagnoseVideoScheduler, safeVideoSchedulerMetrics, videoSchedulerRecord,
} from './video-scheduler-observability.policy';

const now = 1_800_000_000_000;
test('unknown and expired cycles are UNVERIFIED, not healthy', () => {
  const key = 'submitQueuedVideoProcessing';
  assert.equal(diagnoseVideoScheduler(key, null, now).health, 'UNVERIFIED');
  const record = videoSchedulerRecord(key, 'cycle-1', now - 60_000,
    now - 30_000, 'OK', 'FINISHED', { selected: 0 });
  assert.equal(diagnoseVideoScheduler(key, record, now).health, 'OPERATIONAL');
  assert.equal(diagnoseVideoScheduler(key, record, now + 26 * 60_000).health, 'UNVERIFIED');
  assert.equal(diagnoseVideoScheduler(key, { ...record, scheduler: 'wrong' }, now).health, 'UNVERIFIED');
  assert.equal(diagnoseVideoScheduler(key, { ...record, finishedAt: now + 1 }, now).health, 'UNVERIFIED');
});

test('failure and backlog attention differ from successful empty cycles', () => {
  for (const [outcome, expected] of [
    ['OK', 'OPERATIONAL'], ['ATTENTION', 'DEGRADED'], ['FAILED', 'FAILED'],
  ] as const) {
    const record = videoSchedulerRecord(
      'cleanupCancelledVideoProcessing', 'cycle', now - 1_000,
      now, outcome, 'EXECUTE', { selected: 0, batchLimitReached: false }
    );
    const diagnostic = diagnoseVideoScheduler('cleanupCancelledVideoProcessing', record, now + 1);
    assert.equal(diagnostic.health, expected);
    assert.equal(diagnostic.intervalMinutes, 30);
  }
});

test('observability refuses identifiers, errors and raw private messages', () => {
  const payload = { selected: 3, taskRejected: 1, batchLimitReached: true,
    ownerUid: 'private', lastError: 'secret', taskIndex: 44,
  } as unknown as Parameters<typeof safeVideoSchedulerMetrics>[0];
  assert.deepEqual(safeVideoSchedulerMetrics(payload), {
    selected: 3, taskRejected: 1, batchLimitReached: true,
  });
});

test('runtime completion and job evidence are independent and versioned', () => {
  const name = 'reconcileVideoProcessing';
  const successful = videoSchedulerRecord(name, 'ok', now - 500, now,
    'OK', 'EXECUTE', { providerNonterminal: 1 });
  const healthy = diagnoseVideoScheduler(name, successful, now + 5);
  assert.equal(healthy.executionHealth, 'EXECUTED');
  assert.equal(healthy.jobsHealth, 'NO_ALERTS_OBSERVED');

  const pending = videoSchedulerRecord(name, 'pending', now - 500, now,
    'ATTENTION', 'EXECUTE', { providerPollErrors: 1 });
  const degraded = diagnoseVideoScheduler(name, pending, now + 5);
  assert.equal(degraded.executionHealth, 'EXECUTED');
  assert.equal(degraded.jobsHealth, 'ATTENTION');
  assert.equal(degraded.health, 'DEGRADED');

  const failed = videoSchedulerRecord(name, 'failure', now - 500, now,
    'FAILED', 'EXECUTE', {});
  assert.equal(diagnoseVideoScheduler(name, failed, now + 5).executionHealth, 'FAILED');
  assert.equal(diagnoseVideoScheduler(name, failed, now + 5).jobsHealth, 'UNVERIFIED');

  const legacy = { ...successful, evidenceVersion: 2 };
  assert.equal(diagnoseVideoScheduler(name, legacy, now + 5).jobsHealth, 'UNVERIFIED');
  assert.equal(diagnoseVideoScheduler(name, successful, now + 30 * 60_000)
    .executionHealth, 'UNVERIFIED');
});

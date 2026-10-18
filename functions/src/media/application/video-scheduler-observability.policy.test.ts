import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  diagnoseVideoScheduler, safeVideoSchedulerMetrics, videoSchedulerRecord,
  mergeVideoSchedulerEvidence, VIDEO_SCHEDULER_INCIDENT_LIMIT,
  VIDEO_SCHEDULER_INCIDENT_WINDOW_MS,
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


test('bounded incidents survive later healthy empty cycles without conflating job health', () => {
  const name = 'reconcileVideoProcessing';
  const problem = videoSchedulerRecord(name, 'problem', now - 10_000,
    now - 9_000, 'ATTENTION', 'EXECUTE', { providerReviewRequired: 1 });
  const clean = videoSchedulerRecord(name, 'clean', now - 1000,
    now, 'OK', 'EXECUTE', { selected: 0 });
  const evidence = mergeVideoSchedulerEvidence(
    mergeVideoSchedulerEvidence(null, problem), clean
  );
  assert.ok(evidence);
  const status = diagnoseVideoScheduler(name, evidence, now);
  assert.equal(status.health, 'OPERATIONAL');
  assert.equal(status.jobsHealth, 'NO_ALERTS_OBSERVED');
  assert.equal(status.recentIncident?.outcome, 'ATTENTION');
  assert.equal(status.recentIncidentCount, 1);
  assert.equal(status.historyCoverage, 'BEST_EFFORT');
  assert.equal(status.evidenceConfidence, 'RECENT');
  assert.equal(status.metrics.selected, 0);
});

test('history is deterministic for tied timestamps and pruned at fixed bounds', () => {
  const name = 'submitQueuedVideoProcessing';
  const bad = videoSchedulerRecord(name, 'tie-a', now - 100, now, 'FAILED', 'QUERY', {});
  const good = videoSchedulerRecord(name, 'tie-b', now - 100, now, 'OK', 'EXECUTE', {});
  const forward = mergeVideoSchedulerEvidence(mergeVideoSchedulerEvidence(null, bad), good);
  const reverse = mergeVideoSchedulerEvidence(mergeVideoSchedulerEvidence(null, good), bad);
  assert.deepEqual(forward, reverse);
  assert.equal(forward?.cycleId, good.cycleId);
  assert.equal(forward?.recentIncidents[0]?.outcome, 'FAILED');
  assert.equal(mergeVideoSchedulerEvidence(forward, bad), null);
  let current = forward;
  for (let index = 0; index < 9; index++) {
    const item = videoSchedulerRecord(name, 'new-' + index,
      now + index * 1000, now + index * 1000 + 1, 'FAILED', 'QUERY', {});
    current = mergeVideoSchedulerEvidence(current, item);
  }
  assert.equal(current?.recentIncidents.length, VIDEO_SCHEDULER_INCIDENT_LIMIT);
  const later = videoSchedulerRecord(name, 'after-window',
    now + VIDEO_SCHEDULER_INCIDENT_WINDOW_MS + 2000,
    now + VIDEO_SCHEDULER_INCIDENT_WINDOW_MS + 3000, 'OK', 'EXECUTE', {});
  assert.equal(mergeVideoSchedulerEvidence(current, later)?.recentIncidents.length, 0);
});

test('missing, invalid and stale telemetry are not processing failures', () => {
  const name = 'cleanupCancelledVideoProcessing';
  const failure = videoSchedulerRecord(name, 'old',
    now - 25 * 60 * 60_000, now - 25 * 60 * 60_000 + 100,
    'FAILED', 'QUERY', {});
  const stale = diagnoseVideoScheduler(name, failure, now);
  assert.equal(stale.health, 'UNVERIFIED');
  assert.equal(stale.evidenceConfidence, 'STALE');
  assert.equal(stale.recentIncident, null);
  assert.equal(diagnoseVideoScheduler(name, null, now).evidenceConfidence, 'MISSING');
  assert.equal(diagnoseVideoScheduler(name,
    { ...failure, finishedAt: now + 1 }, now).evidenceConfidence, 'INVALID');
});

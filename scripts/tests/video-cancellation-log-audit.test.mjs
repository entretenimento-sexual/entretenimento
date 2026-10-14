import assert from 'node:assert/strict';
import test from 'node:test';
import {
  summarizeExportedCancellationLogs,
} from '../dev/video-cancellation-log-audit.policy.mjs';

const a = 'a38dbd2e-c14a-4cb7-92ef-b3e38c3bcf20';
const b = 'b38dbd2e-c14a-4cb7-92ef-b3e38c3bcf20';
const c = 'c38dbd2e-c14a-4cb7-92ef-b3e38c3bcf20';
const stamp = '2026-10-14T18:00:00.000Z';
const log = (cycleId, kind, timestamp = stamp, extra = {}) => ({
  timestamp,
  jsonPayload: { event: 'VIDEO_CANCELLATION_CYCLE_' + kind, cycleId, ...extra },
});

test('correlates starts, completions, failures and unfinished cycles', () => {
  const report = summarizeExportedCancellationLogs([
    log(a, 'STARTED'),
    log(a, 'FINISHED', '2026-10-14T18:01:00Z', {
      status: 'OK', selected: 1, completed: 1, durationMs: 60000,
    }),
    log(b, 'STARTED'),
    log(b, 'FAILED', '2026-10-14T18:02:00Z'),
    log(c, 'STARTED'),
  ]);
  assert.equal(report.observedCycles, 3);
  assert.equal(report.finishedCycles, 1);
  assert.equal(report.failedCycles, 1);
  assert.equal(report.startedWithoutTerminal, 1);
  assert.equal(report.schedulerHealth, 'NOT_VERIFIED');
  assert.equal(report.latestCompletion.metrics.completed, 1);
  assert.equal(report.latestTerminalAt, '2026-10-14T18:02:00.000Z');
});

test('missing STARTED is partial evidence, not confirmed scheduler failure', () => {
  const report = summarizeExportedCancellationLogs([log(a, 'FINISHED')]);
  assert.equal(report.terminalWithoutStart, 1);
  assert.equal(report.finishedCycles, 1);
  assert.equal(report.schedulerHealth, 'NOT_VERIFIED');
});

test('private fields and untrusted text cannot leak into summary', () => {
  const report = summarizeExportedCancellationLogs([
    log(a, 'FINISHED', stamp, {
      ownerUid: 'private-user',
      externalJobName: 'projects/secret/jobs/private',
      lastError: 'private-message',
      status: 'ATTENTION', selected: 5, completed: 'ten', invalid: -20,
    }),
    log('not-a-cycle', 'STARTED'),
    { timestamp: stamp, jsonPayload: { event: 'OTHER', ownerUid: 'private-user' } },
  ]);
  const encoded = JSON.stringify(report);
  assert.equal(report.acceptedEvents, 1);
  assert.equal(report.ignoredEvents, 2);
  assert.equal(report.latestCompletion.metrics.completed, null);
  assert.equal(report.latestCompletion.metrics.invalid, null);
  assert.ok(!encoded.includes('private-user'));
  assert.ok(!encoded.includes('secret'));
  assert.ok(!encoded.includes(a));
});

test('duplicate logs do not double count a cycle', () => {
  const entry = log(a, 'FINISHED');
  const report = summarizeExportedCancellationLogs([entry, entry, log(a, 'STARTED')]);
  assert.equal(report.observedCycles, 1);
  assert.equal(report.finishedCycles, 1);
});

test('empty and export-limited samples remain unverified', () => {
  const report = summarizeExportedCancellationLogs([]);
  assert.equal(report.latestTerminalAt, null);
  assert.equal(report.schedulerHealth, 'NOT_VERIFIED');
  assert.equal(summarizeExportedCancellationLogs(
    [log(a, 'STARTED')], { exportLimit: 1 }
  ).sampleMayBeTruncated, true);
});

test('malformed and excessive inputs are rejected', () => {
  assert.throws(() => summarizeExportedCancellationLogs({}));
  assert.throws(() => summarizeExportedCancellationLogs(
    Array.from({ length: 2001 }, () => ({}))
  ));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeExportedVideoSchedulerLogs as summarize } from '../dev/video-scheduler-log-audit.policy.mjs';

const ids = [
  'a38dbd2e-c14a-4cb7-92ef-b3e38c3bcf20',
  'b38dbd2e-c14a-4cb7-92ef-b3e38c3bcf20',
  'c38dbd2e-c14a-4cb7-92ef-b3e38c3bcf20',
  'd38dbd2e-c14a-4cb7-92ef-b3e38c3bcf20',
];
const base = Date.parse('2026-10-18T10:00:00Z');
const at = offset => new Date(base + offset * 60_000).toISOString();
const entry = (scheduler, kind, id, minutes, extra = {}) => ({
  timestamp: at(minutes),
  jsonPayload: {
    event: 'VIDEO_MEDIA_SCHEDULER_' + kind,
    scheduler, cycleId: id, ...extra,
  },
});
const cancel = (kind, id, minutes, extra = {}) => ({
  timestamp: at(minutes),
  jsonPayload: { event: 'VIDEO_CANCELLATION_CYCLE_' + kind, cycleId: id, ...extra },
});
const warn = (scheduler, id, minutes) => ({
  timestamp: at(minutes),
  jsonPayload: {
    event: 'VIDEO_MEDIA_SCHEDULER_EVIDENCE_UNAVAILABLE',
    scheduler, ...(id ? { cycleId: id } : {}),
    outcome: 'OK', evidenceReliability: 'WRITE_UNCONFIRMED',
  },
});
const get = (report, name) => report.schedulers.find(s => s.scheduler === name);

test('all three schedulers: correlated start, terminal, empty job cycle and failure', () => {
  const report = summarize([
    entry('submitQueuedVideoProcessing', 'STARTED', ids[0], 0),
    entry('submitQueuedVideoProcessing', 'FINISHED', ids[0], 1,
      { outcome: 'OK', metrics: { selected: 0, taskRejected: 0 } }),
    entry('reconcileVideoProcessing', 'STARTED', ids[1], 2),
    entry('reconcileVideoProcessing', 'FAILED', ids[1], 4),
    cancel('STARTED', ids[2], 5),
    cancel('FINISHED', ids[2], 7, { status: 'ATTENTION', selected: 3 }),
  ]);
  assert.equal(report.acceptedEvents, 6);
  assert.equal(get(report, 'submitQueuedVideoProcessing').classification, 'EXECUTION_OBSERVED');
  assert.equal(get(report, 'submitQueuedVideoProcessing').latestCompletion.selected, 0);
  assert.equal(get(report, 'reconcileVideoProcessing').classification, 'FAILED_CONFIRMED');
  assert.equal(get(report, 'cleanupCancelledVideoProcessing').latestCompletion.outcome, 'ATTENTION');
  assert.equal(report.schedulerHealth, 'NOT_VERIFIED');
});

test('interleaved cycles and reversed export order do not imply failed processing', () => {
  const events = [
    entry('reconcileVideoProcessing', 'STARTED', ids[0], 0),
    entry('reconcileVideoProcessing', 'STARTED', ids[1], 1),
    entry('reconcileVideoProcessing', 'FINISHED', ids[1], 2, { outcome: 'OK' }),
    entry('reconcileVideoProcessing', 'FINISHED', ids[0], 3, { outcome: 'OK' }),
  ];
  for (const data of [events, [...events].reverse()]) {
    const scheduler = get(summarize(data), 'reconcileVideoProcessing');
    assert.equal(scheduler.overlappingCycles, 1);
    assert.equal(scheduler.observedCycles, 2);
    assert.equal(scheduler.classification, 'EXECUTION_OBSERVED');
    assert.equal(scheduler.latestTerminalAt, at(3));
  }
});

test('suspicious gap requires observed starts on both sides; missing exports remain unknown', () => {
  const a = 'submitQueuedVideoProcessing';
  const scheduler = get(summarize([
    entry(a, 'STARTED', ids[0], 0),
    entry(a, 'FINISHED', ids[0], 1, { outcome: 'OK' }),
    entry(a, 'STARTED', ids[1], 20),
    entry(a, 'FINISHED', ids[1], 21, { outcome: 'OK' }),
  ]), a);
  assert.equal(scheduler.suspectedGaps, 1);
  assert.equal(scheduler.classification, 'SUSPECTED_GAP');
  assert.equal(scheduler.longestStartGapMs, 20 * 60_000);
  const partial = summarize([entry(a, 'FINISHED', ids[0], 1, { outcome: 'OK' })]);
  assert.equal(get(partial, a).terminalWithoutStart, 1);
  assert.equal(get(partial, a).suspectedGaps, 0);
  assert.equal(partial.schedulersWithoutEvents, 2);
  assert.equal(get(summarize([]), a).classification, 'INSUFFICIENT_EVIDENCE');
});

test('duplicates, contradictory terminals and missing terminal are diagnostic only', () => {
  const a = 'reconcileVideoProcessing';
  const start = entry(a, 'STARTED', ids[0], 0);
  const report = get(summarize([
    start, start, entry(a, 'FINISHED', ids[0], 2, { outcome: 'OK' }),
    entry(a, 'FAILED', ids[0], 3),
    entry(a, 'STARTED', ids[1], 5),
    entry(a, 'FINISHED', ids[2], 6, { outcome: 'OK' }),
  ]), a);
  assert.equal(report.duplicateEvents, 1);
  assert.equal(report.conflictingTerminals, 1);
  assert.equal(report.startedWithoutTerminal, 1);
  assert.equal(report.terminalWithoutStart, 1);
  assert.equal(report.classification, 'FAILED_CONFIRMED');
});

test('telemetry failure correlates by cycleId when present; legacy warning remains unlinked', () => {
  const a = 'submitQueuedVideoProcessing';
  const report = get(summarize([
    entry(a, 'STARTED', ids[0], 0),
    entry(a, 'FINISHED', ids[0], 1, { outcome: 'OK' }),
    warn(a, ids[0], 2), warn(a, ids[0], 2),
    warn(a, ids[1], 3), warn(a, null, 4),
  ]), a);
  assert.equal(report.telemetryWriteUnconfirmed, 3);
  assert.equal(report.correlatedTelemetryWarnings, 1);
  assert.equal(report.uncorrelatedTelemetryWarnings, 2);
  assert.equal(report.duplicateEvents, 1);
  assert.equal(report.classification, 'EXECUTION_OBSERVED');
});

test('bounded and incomplete exports never imply scheduler health', () => {
  assert.equal(summarize([], { exportLimit: 1 }).sampleMayBeTruncated, false);
  assert.equal(summarize([cancel('STARTED', ids[0], 0)],
    { exportLimit: 1 }).sampleMayBeTruncated, true);
  assert.throws(() => summarize({}));
  assert.throws(() => summarize(Array.from({ length: 2001 }, () => ({}))));
  assert.throws(() => summarize([], { exportLimit: 0 }));
  assert.throws(() => summarize([], { exportLimit: 2001 }));
});

test('invalid events, unknown names and private fields never enter output', () => {
  const secret = 'sensitive-user-token-or-private-job';
  const a = 'submitQueuedVideoProcessing';
  const report = summarize([
    entry(a, 'STARTED', ids[0], 0, { ownerUid: secret }),
    entry(a, 'FINISHED', ids[0], 1, {
      outcome: 'OK', metrics: { selected: 1, lastError: secret },
      externalJobName: secret,
    }),
    entry('unexpected-name', 'FAILED', ids[1], 2),
    entry(a, 'STARTED', secret, 3),
    { timestamp: 'bad date', jsonPayload: { event: 'VIDEO_MEDIA_SCHEDULER_FAILED',
      scheduler: a, cycleId: ids[2], error: secret } },
    { timestamp: at(2), jsonPayload: { event: 'OTHER', message: secret } },
  ]);
  assert.equal(report.acceptedEvents, 2);
  assert.equal(report.ignoredEvents, 4);
  for (const hidden of [secret, ids[0], ids[1], 'externalJobName', 'ownerUid']) {
    assert.ok(!JSON.stringify(report).includes(hidden));
  }
});

const CLI = fileURLToPath(new URL('../dev/inspect-video-scheduler-logs.mjs', import.meta.url));
function runCli(raw, name = 'logs.json') {
  const dir = mkdtempSync(join(tmpdir(), 'video-scheduler-audit-'));
  try {
    const path = join(dir, name);
    writeFileSync(path, raw);
    return spawnSync(process.execPath, [CLI, path],
      { encoding: 'utf8', timeout: 10_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('CLI handles BOM and Cloud Logging exports without printing identifiers', () => {
  const logs = { entries: [entry('reconcileVideoProcessing', 'STARTED', ids[0], 0),
    entry('reconcileVideoProcessing', 'FINISHED', ids[0], 1,
      { outcome: 'OK', lastError: 'private-message' })] };
  const run = runCli('\uFEFF' + JSON.stringify(logs));
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /EXECUTION_OBSERVED/);
  assert.match(run.stdout, /NOT_VERIFIED/);
  assert.ok(!run.stdout.includes(ids[0]));
  assert.ok(!run.stdout.includes('private-message'));
});

test('CLI rejects malformed, oversized, unsupported or extra arguments', () => {
  assert.equal(runCli('{private-data-invalid-json').status, 1);
  assert.equal(runCli(' '.repeat(8 * 1024 * 1024 + 1)).status, 1);
  assert.equal(runCli('[]', 'raw.txt').status, 1);
  for (const args of [[], ['--help'], ['first.json', 'second.json']]) {
    assert.equal(spawnSync(process.execPath, [CLI, ...args],
      { encoding: 'utf8', timeout: 10_000 }).status, 1);
  }
});

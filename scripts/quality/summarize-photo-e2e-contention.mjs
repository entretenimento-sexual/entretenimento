#!/usr/bin/env node
// Offline diagnostic summary. The complete emulator log may contain private IDs.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

export function newPhotoE2EContentionSummary() {
  return {
    evidence: 'EMULATOR_LOGS_ONLY',
    executionResult: 'NOT_INFERRED',
    firestoreLockTimeoutLines: 0,
    abortedLines: 0,
    transactionCasesObservedPassing: 0,
    revocationSuiteCompletedObserved: false,
    revocationSuiteExpectedCases: null,
    revocationTimedCases: 0,
    revocationMaxFirstReadWaitMs: 0,
    revocationMaxCompetingWriteWaitMs: 0,
    revocationMaxSettleWaitMs: 0,
    revocationMaxScenarioMs: 0,
    revocationMaxAttempts: 0,
    revocationSuiteWallMs: null,
  };
}

export function addPhotoE2ELogLine(summary, line) {
  if (typeof line !== 'string') return summary;
  // These are log line counts, NOT distinct Firestore operations:
  // Firebase debug output can mirror the same emulator warning several times.
  if (line.includes('Transaction lock timeout.')) {
    summary.firestoreLockTimeoutLines += 1;
  }
  if (line.includes('ABORTED')) summary.abortedLines += 1;
  if (line.includes('[media-tx:e2e] PASS allowed: ') ||
      line.includes('[media-tx:e2e] PASS revoked: ')) {
    summary.transactionCasesObservedPassing += 1;
  }
  const match = line.match(/\[media-tx:e2e\] PASS: (\d+) cenários/);
  if (match && Number.isSafeInteger(Number(match[1])) && Number(match[1]) < 1000) {
    summary.revocationSuiteCompletedObserved = true;
    summary.revocationSuiteExpectedCases = Number(match[1]);
  }
  // Only consume explicitly allowlisted numeric telemetry; never echo
  // raw log lines, document IDs, exception bodies, or arbitrary JSON keys.
  const timingMarker = '[media-tx:e2e] TIMING ';
  const index = line.indexOf(timingMarker);
  if (index !== -1) {
    try {
      const timing = JSON.parse(line.slice(index + timingMarker.length));
      const fields = [
        'firstReadWaitMs', 'competingWriteWaitMs', 'settleWaitMs',
        'totalMs', 'attempts',
      ];
      if (fields.every((key) => Number.isSafeInteger(timing[key]) &&
            timing[key] >= 0 && timing[key] < 3_600_000) &&
          timing.attempts >= 2) {
        summary.revocationTimedCases += 1;
        summary.revocationMaxFirstReadWaitMs = Math.max(
          summary.revocationMaxFirstReadWaitMs, timing.firstReadWaitMs);
        summary.revocationMaxCompetingWriteWaitMs = Math.max(
          summary.revocationMaxCompetingWriteWaitMs, timing.competingWriteWaitMs);
        summary.revocationMaxSettleWaitMs = Math.max(
          summary.revocationMaxSettleWaitMs, timing.settleWaitMs);
        summary.revocationMaxScenarioMs = Math.max(
          summary.revocationMaxScenarioMs, timing.totalMs);
        summary.revocationMaxAttempts = Math.max(
          summary.revocationMaxAttempts, timing.attempts);
      }
    } catch {
      // Malformed or non-numeric diagnostic entries are never trusted.
    }
  }
  const duration = line.match(/\[media-tx:e2e\] DURATION_MS (\d+)(?:\s|$)/);
  if (duration) {
    const ms = Number(duration[1]);
    if (Number.isSafeInteger(ms) && ms < 3_600_000) {
      summary.revocationSuiteWallMs = ms;
    }
  }
  return summary;
}

async function summarizeFile(path) {
  const data = await stat(path);
  if (!data.isFile() || data.size > 64 * 1024 * 1024) {
    throw new Error('Invalid emulator log.');
  }
  const summary = newPhotoE2EContentionSummary();
  const stream = createReadStream(path, { encoding: 'utf8' });
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      addPhotoE2ELogLine(summary, line);
    }
  } finally {
    stream.destroy();
  }
  return summary;
}

if (process.argv[1] && import.meta.url === new URL(
  'file://' + process.argv[1].replaceAll('\\', '/')
).href) {
  const path = process.argv[2];
  if (process.argv.length !== 3 || !path || path.startsWith('-')) {
    console.error('[photo-e2e] Usage: summarize-photo-e2e-contention.mjs FILE');
    process.exitCode = 1;
  } else {
    try {
      const result = await summarizeFile(path);
      console.log('[photo-e2e] Diagnostic-only summary (no user identifiers):');
      console.log(JSON.stringify(result, null, 2));
      console.log('[photo-e2e] Warnings are not failures; check the test job exit status.');
    } catch {
      console.error('[photo-e2e] Unable to inspect emulator log.');
      process.exitCode = 1;
    }
  }
}

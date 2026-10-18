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

import assert from 'node:assert/strict';
import test from 'node:test';
import { newPhotoE2EContentionSummary, addPhotoE2ELogLine } from
  '../quality/summarize-photo-e2e-contention.mjs';

test('counts contention warnings without treating them as failed or recovered transactions', () => {
  const summary = newPhotoE2EContentionSummary();
  addPhotoE2ELogLine(summary, 'WARNING: Operation failed: Transaction lock timeout.');
  addPhotoE2ELogLine(summary, 'com.google.cloud.datastore.core.exception.DatastoreException: Transaction lock timeout.');
  addPhotoE2ELogLine(summary, 'ABORTED');
  assert.equal(summary.firestoreLockTimeoutLines, 2);
  assert.equal(summary.abortedLines, 1);
  assert.equal(summary.executionResult, 'NOT_INFERRED');
});

test('positive test markers remain evidence of tests only, not emulator health', () => {
  const summary = newPhotoE2EContentionSummary();
  addPhotoE2ELogLine(summary, '[media-tx:e2e] PASS allowed: photo active viewer');
  addPhotoE2ELogLine(summary, '[media-tx:e2e] PASS revoked: photo blocked by owner');
  addPhotoE2ELogLine(summary, '[media-tx:e2e] PASS: 11 cenários, transações reais.');
  assert.equal(summary.transactionCasesObservedPassing, 2);
  assert.equal(summary.revocationSuiteExpectedCases, 11);
  assert.equal(summary.revocationSuiteCompletedObserved, true);
  assert.equal(summary.executionResult, 'NOT_INFERRED');
});

test('raw identifiers, private data and unexpected output never flow into the summary', () => {
  const summary = newPhotoE2EContentionSummary();
  for (const line of [
    'users/private-client-123 was denied: user email user@example.test',
    '[media-tx:e2e] PASS revoked: photo blocked by private-client-123',
    'operation ABORTED for projects/private/jobs/secret',
  ]) addPhotoE2ELogLine(summary, line);
  const output = JSON.stringify(summary);
  for (const token of ['private-client-123', 'user@example.test', 'secret']) {
    assert.ok(!output.includes(token));
  }
  assert.equal(summary.abortedLines, 1);
});

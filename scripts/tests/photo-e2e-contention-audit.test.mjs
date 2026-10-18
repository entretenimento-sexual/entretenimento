import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPhotoE2EPerformance } from '../quality/photo-e2e-performance.policy.mjs';
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

test('summarizes bounded revocation performance using numeric allowlist only', () => {
  const summary = newPhotoE2EContentionSummary();
  addPhotoE2ELogLine(summary, '[media-tx:e2e] TIMING ' +
    JSON.stringify({
      firstReadWaitMs: 100, competingWriteWaitMs: 67000,
      settleWaitMs: 15, totalMs: 67500, attempts: 2,
      uid: 'private-client-123', email: 'user@example.test',
    }));
  addPhotoE2ELogLine(summary, '[media-tx:e2e] TIMING ' +
    JSON.stringify({
      firstReadWaitMs: 80, competingWriteWaitMs: 64000,
      settleWaitMs: 22, totalMs: 64500, attempts: 3,
    }));
  addPhotoE2ELogLine(summary, '[media-tx:e2e] DURATION_MS 197000');
  assert.equal(summary.revocationTimedCases, 2);
  assert.equal(summary.revocationMaxCompetingWriteWaitMs, 67000);
  assert.equal(summary.revocationMaxSettleWaitMs, 22);
  assert.equal(summary.revocationMaxAttempts, 3);
  assert.equal(summary.revocationSuiteWallMs, 197000);
  assert.equal(summary.executionResult, 'NOT_INFERRED');
  assert.ok(!JSON.stringify(summary).includes('private-client-123'));
  assert.ok(!JSON.stringify(summary).includes('user@example.test'));
});

test('ignores missing or invalid timing rather than inferring test success', () => {
  const summary = newPhotoE2EContentionSummary();
  addPhotoE2ELogLine(summary,
    '[media-tx:e2e] TIMING {"totalMs":12,"attempts":1}');
  addPhotoE2ELogLine(summary,
    '[media-tx:e2e] TIMING {"totalMs":-1,"attempts":2}');
  addPhotoE2ELogLine(summary,
    '[media-tx:e2e] TIMING invalid-private-data');
  addPhotoE2ELogLine(summary,
    '[media-tx:e2e] DURATION_MS private');
  assert.equal(summary.revocationTimedCases, 0);
  assert.equal(summary.revocationSuiteWallMs, null);
  assert.equal(summary.executionResult, 'NOT_INFERRED');
});

test('incomplete or aborted revocation run does not imply security health', () => {
  const summary = newPhotoE2EContentionSummary();
  addPhotoE2ELogLine(summary, 'ABORTED');
  addPhotoE2ELogLine(summary, '[media-tx:e2e] DURATION_MS 1900');
  const assessment = assessPhotoE2EPerformance(summary);
  assert.equal(assessment.performanceSignal, 'NOT_ASSESSED');
  assert.equal(assessment.securityResult, 'NOT_INFERRED');
});

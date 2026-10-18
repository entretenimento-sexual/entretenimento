import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessPhotoE2EPerformance,
  REVOCATION_REFERENCE_MS,
  REVOCATION_REVIEW_THRESHOLD_MS,
} from '../quality/photo-e2e-performance.policy.mjs';

function completeLog(duration = REVOCATION_REFERENCE_MS) {
  return {
    revocationSuiteCompletedObserved: true,
    revocationSuiteExpectedCases: 11,
    transactionCasesObservedPassing: 11,
    revocationTimedCases: 9,
    revocationMaxAttempts: 2,
    revocationSuiteWallMs: duration,
    firestoreLockTimeoutLines: 0,
    abortedLines: 0,
  };
}

test('single c13 reference is advisory and does not infer CI success', () => {
  const result = assessPhotoE2EPerformance(completeLog());
  assert.equal(result.authority, 'ADVISORY_ONLY');
  assert.equal(result.securityResult, 'NOT_INFERRED');
  assert.equal(result.performanceSignal, 'NO_REGRESSION_SIGNAL');
  assert.equal(result.evidence, 'COMPLETE_LOG_MARKERS');
});

test('long emulator lock waits prompt review but never fail security checks', () => {
  const result = assessPhotoE2EPerformance(
    completeLog(REVOCATION_REVIEW_THRESHOLD_MS + 1)
  );
  assert.equal(result.performanceSignal, 'REVIEW_LATENCY');
  assert.equal(result.authority, 'ADVISORY_ONLY');
  assert.equal(result.securityResult, 'NOT_INFERRED');
});

test('incomplete evidence is never mislabeled healthy, even when fast', () => {
  for (const patch of [
    { revocationTimedCases: 8 },
    { transactionCasesObservedPassing: 10 },
    { revocationSuiteCompletedObserved: false },
    { revocationSuiteExpectedCases: null },
    { revocationSuiteWallMs: null },
    { revocationMaxAttempts: 1 },
  ]) {
    const result = assessPhotoE2EPerformance({ ...completeLog(1), ...patch });
    assert.equal(result.evidence, 'INCOMPLETE_LOG_MARKERS');
    assert.equal(result.performanceSignal, 'NOT_ASSESSED');
  }
});

test('absence of emulator warnings is not a proof of safety', () => {
  const s = completeLog(2_000);
  s.revocationTimedCases = 0;
  const r = assessPhotoE2EPerformance(s);
  assert.equal(s.firestoreLockTimeoutLines, 0);
  assert.equal(r.securityResult, 'NOT_INFERRED');
  assert.equal(r.performanceSignal, 'NOT_ASSESSED');
});

test('untrusted diagnostic metadata is never echoed', () => {
  const result = assessPhotoE2EPerformance({
    ...completeLog(),
    uid: 'private-id',
    stack: 'secret-trace',
  });
  assert.ok(!JSON.stringify(result).includes('private-id'));
  assert.ok(!JSON.stringify(result).includes('secret-trace'));
});

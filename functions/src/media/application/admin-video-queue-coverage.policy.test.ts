import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditRecoveryQueuePage,
  auditTerminalQueuePage,
  type RecoveryQueueAuditCandidate,
} from './admin-video-queue-coverage.policy';

test('c18b large mixed legacy cohorts never imply global coverage', () => {
  const records: RecoveryQueueAuditCandidate[] = [];
  for (let i = 0; i < 8_000; i++) {
    records.push({
      state: i % 7 === 0 ? 'FAILED' : 'PROCESSING',
      timestampEvidence: i % 11 === 0 ? 'UNVERIFIED' :
        i % 5 === 0 ? 'CREATED_FALLBACK' : 'UPDATED',
      requiresProviderReview: i % 17 === 0,
      providerPollReviewRequired: i % 41 === 0,
      requiresOperationalAttention: i === 7_999,
      stale: i % 3 === 0,
      unconfirmedSubmission: i % 23 === 0,
    });
  }
  // A critical cancellation near the end is invisible to the first ID page.
  const first = auditRecoveryQueuePage(records.slice(0, 30), 2);
  const last = auditRecoveryQueuePage(records.slice(-30), 0);
  assert.equal(first.scope, 'PAGE_ONLY');
  assert.equal(first.observed, 30);
  assert.equal(first.invalidDocuments, 2);
  assert.equal(first.overdueCancellation, 0);
  assert.equal(last.overdueCancellation, 1);
  assert.equal(first.updatedTimestamp + first.createdFallback +
    first.unverifiedTimestamp, 30);
  const whole = auditRecoveryQueuePage(records, 0);
  assert.equal(whole.observed, 8_000);
  assert.equal(whole.overdueCancellation, 1);
  assert.equal(whole.providerPollReview, records.filter(x =>
    x.providerPollReviewRequired).length);
  assert.equal(whole.unconfirmedSubmission, records.filter(x =>
    x.unconfirmedSubmission).length);
});

test('c18b concurrent lane moves can duplicate page observations', () => {
  const row: RecoveryQueueAuditCandidate = {
    state: 'QUEUED', timestampEvidence: 'UNVERIFIED',
    requiresProviderReview: false, providerPollReviewRequired: false,
    requiresOperationalAttention: false, stale: false,
    unconfirmedSubmission: false,
  };
  const first = auditRecoveryQueuePage([row], 0);
  const second = auditRecoveryQueuePage([{ ...row, state: 'FAILED' }], 0);
  assert.equal(first.observed + second.observed, 2);
  assert.equal(first.unverifiedTimestamp + second.unverifiedTimestamp, 2);
  assert.equal(second.failed, 1);
  assert.equal(first.scope, 'PAGE_ONLY');
});

test('c18b terminal audit counts unknown age without bypassing blockers', () => {
  const result = auditTerminalQueuePage([
    { updatedAt: 0, recheckable: false },
    { updatedAt: 100, recheckable: true },
    { updatedAt: 0, recheckable: false },
  ]);
  assert.deepEqual(result, {
    scope: 'PAGE_ONLY', observed: 3,
    unverifiedTimestamp: 2, blocked: 2, recheckable: 1,
  });
});

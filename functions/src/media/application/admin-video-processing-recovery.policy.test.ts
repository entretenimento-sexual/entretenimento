import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availableAdminVideoRecoveryActions,
  isUnconfirmedVideoSubmission,
  isUnsafeVideoProcessingRetry,
  isOverdueVideoCancellation,
  videoRecoveryRequiresProviderReview,
} from './admin-video-processing-recovery.policy';

test('unconfirmed submission offers explicit provider recheck but never retry', () => {
  const job = {
    state: 'SUBMITTING' as const,
    lastErrorCode: 'SUBMISSION_UNCONFIRMED',
    externalJobName: null,
    leaseUntil: null,
  };
  assert.equal(isUnconfirmedVideoSubmission(job), true);
  assert.equal(videoRecoveryRequiresProviderReview(job), true);
  assert.deepEqual(availableAdminVideoRecoveryActions(job, false), [
    'RECHECK_UNCONFIRMED', 'CANCEL_ACTIVE',
  ]);
  assert.deepEqual(availableAdminVideoRecoveryActions({
    ...job, leaseUntil: 1000,
  }, true), ['CANCEL_ACTIVE']);
});

test('legacy failed ambiguous submissions are blocked from automatic retries', () => {
  for (const lastErrorCode of [
    'SUBMISSION_NOT_FOUND',
    'SUBMISSION_UNCONFIRMED',
    'TRANSCODER_SUBMISSION_UNCONFIRMED',
  ]) {
    const job = { state: 'FAILED' as const, lastErrorCode };
    assert.equal(isUnsafeVideoProcessingRetry(job), true);
    assert.deepEqual(availableAdminVideoRecoveryActions(job, true), []);
    assert.equal(videoRecoveryRequiresProviderReview(job), true);
  }
  assert.deepEqual(availableAdminVideoRecoveryActions({
    state: 'FAILED', lastErrorCode: 'TRANSCODER_INVALID_SOURCE',
  }, true), ['RETRY_FAILED']);
});

test('normal queued, submitting and cancelled jobs retain safe existing actions', () => {
  assert.deepEqual(availableAdminVideoRecoveryActions({
    state: 'QUEUED',
  }, true), ['RECHECK_STALE', 'CANCEL_ACTIVE']);
  assert.deepEqual(availableAdminVideoRecoveryActions({
    state: 'SUBMITTING', lastErrorCode: 'SUBMISSION_LOOKUP_PENDING',
  }, true), ['RECHECK_STALE', 'CANCEL_ACTIVE']);
  assert.deepEqual(availableAdminVideoRecoveryActions({
    state: 'CANCEL_REQUESTED',
  }, true), []);
  assert.equal(videoRecoveryRequiresProviderReview({
    state: 'CANCEL_REQUESTED', lastErrorCode: 'CANCELLATION_UNCONFIRMED',
  }), true);
});

test('repeated cancellation cleanup failures require administrator attention', () => {
  assert.equal(videoRecoveryRequiresProviderReview({
    state: 'CANCEL_REQUESTED',
    lastErrorCode: 'TRANSIENT',
    cancellationCleanupAttempts: 3,
    cancellationReviewRequired: true,
  }), true);
  assert.equal(videoRecoveryRequiresProviderReview({
    state: 'CANCEL_REQUESTED',
    lastErrorCode: 'TRANSIENT',
    cancellationCleanupAttempts: 1,
    cancellationReviewRequired: false,
  }), false);
});

test('overdue cancellations are operational alerts, not verified provider failures', () => {
  const now = 1_800_000_000_000;
  const job = {
    state: 'CANCEL_REQUESTED' as const,
    cancelRequestedAt: now - 25 * 60 * 60_000,
    nextAttemptAt: now - 60_000,
    cancellationCleanupAttempts: 0,
    cancellationReviewRequired: false,
  };
  assert.equal(isOverdueVideoCancellation(job, now), true);
  assert.equal(videoRecoveryRequiresProviderReview(job), false);
  assert.equal(isOverdueVideoCancellation({
    ...job, nextAttemptAt: now + 60_000,
  }, now), false);
  assert.equal(isOverdueVideoCancellation({
    ...job, cancelRequestedAt: now - 60_000,
  }, now), false);
  assert.equal(isOverdueVideoCancellation({
    ...job, cancelRequestedAt: null,
  }, now), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addVideoProcessingJobToInventory,
  createVideoProcessingInventory,
  inspectVideoProcessingJob,
} from '../dev/video-processing-job-inventory.policy.mjs';

test('legacy PROCESSING without nextAttemptAt is counted, never fixed implicitly', () => {
  const job = { state: 'PROCESSING', processingVersion: 'v-123', externalJobName: 'job' };
  const result = inspectVideoProcessingJob(job, 200);
  assert.equal(result.processingLegacyMissingDue, true);
  assert.equal(result.repairCandidate, true);
  const summary = addVideoProcessingJobToInventory(createVideoProcessingInventory(), job, 200);
  assert.equal(summary.scanned, 1);
  assert.deepEqual(summary.missingNextAttemptAt, { PROCESSING: 1 });
  assert.equal(summary.repairCandidates, 1);
  assert.deepEqual(job, { state: 'PROCESSING', processingVersion: 'v-123', externalJobName: 'job' });
});

test('missing or corrupt version never becomes a migration candidate', () => {
  const missingVersion = inspectVideoProcessingJob({ state: 'PROCESSING' }, 200);
  assert.equal(missingVersion.processingLegacyMissingDue, true);
  assert.equal(missingVersion.repairCandidate, false);
  assert.equal(inspectVideoProcessingJob({
    state: 'PROCESSING', processingVersion: '../unexpected',
  }, 200).repairCandidate, false);
});

test('SUBMITTING distinguishes expired, future and absent lease', () => {
  const base = { state: 'SUBMITTING', nextAttemptAt: 100 };
  assert.equal(inspectVideoProcessingJob({ ...base, leaseUntil: 100 }, 100).submittingExpiredLease, true);
  assert.equal(inspectVideoProcessingJob({ ...base, leaseUntil: 101 }, 100).submittingExpiredLease, false);
  assert.equal(inspectVideoProcessingJob({ ...base, leaseUntil: null }, 100).submittingMissingLease, true);
});

test('invalid due timestamps remain distinct from completely missing fields', () => {
  assert.equal(inspectVideoProcessingJob({
    state: 'PROCESSING', nextAttemptAt: 'tomorrow',
  }, 0).invalidDue, true);
  assert.equal(inspectVideoProcessingJob({
    state: 'PROCESSING', nextAttemptAt: null,
  }, 0).processingLegacyMissingDue, false);
  assert.equal(inspectVideoProcessingJob({
    state: 'SUCCEEDED',
  }, 0).missingDue, false);
});

test('counters aggregate states without exposing any owner or video identifier', () => {
  const summary = createVideoProcessingInventory();
  addVideoProcessingJobToInventory(summary, {
    state: 'PROCESSING', processingVersion: 'v', ownerUid: 'sensitive',
  }, 100);
  addVideoProcessingJobToInventory(summary, { state: 'FAILED', ownerUid: 'private' }, 100);
  assert.deepEqual(summary.states, { PROCESSING: 1, FAILED: 1 });
  assert.equal(JSON.stringify(summary).includes('sensitive'), false);
  assert.equal(JSON.stringify(summary).includes('private'), false);
});

test('cancelled job age is counted without exposing any job identifiers', () => {
  const now = 1_800_000_000_000;
  const inventory = createVideoProcessingInventory();
  const cases = [
    { cancelledAt: now - 1_000, band: 'UNDER_90_MIN' },
    { cancelledAt: now - 91 * 60_000, band: '90_MIN_TO_24_H' },
    { cancelledAt: now - 25 * 60 * 60_000, band: 'OVER_24_H' },
    { cancelledAt: null, band: 'UNKNOWN' },
  ];
  for (const item of cases) {
    const job = {
      state: 'CANCEL_REQUESTED',
      cancelRequestedAt: item.cancelledAt,
      ownerUid: 'private-uid',
    };
    const classified = inspectVideoProcessingJob(job, now);
    assert.equal(classified.cancellationAgeBand, item.band);
    addVideoProcessingJobToInventory(inventory, job, now);
  }
  assert.deepEqual(inventory.cancellationAgeBands, {
    UNDER_90_MIN: 1,
    '90_MIN_TO_24_H': 1,
    OVER_24_H: 1,
    UNKNOWN: 1,
  });
  assert.ok(!JSON.stringify(inventory).includes('private-uid'));
});

test('read-only inventory distinguishes due, deferred, malformed and reviewed cancellations', () => {
  const now = 1_800_000_000_000;
  const summary = createVideoProcessingInventory();
  const cases = [
    { nextAttemptAt: now - 1, cancellationReviewRequired: false },
    { nextAttemptAt: now + 1, cancellationReviewRequired: true },
    { lastErrorCode: 'CANCELLATION_UNCONFIRMED' },
    { nextAttemptAt: 'bad timestamp' },
  ];
  for (const record of cases) {
    addVideoProcessingJobToInventory(
      summary, { ...record, state: 'CANCEL_REQUESTED' }, now
    );
  }
  assert.deepEqual(summary.cancellationScheduling, {
    due: 1,
    overdue24h: 0,
    deferred: 1,
    missingDue: 1,
    invalidDue: 1,
    reviewRequired: 2,
  });
});

test('old due cancellation is operationally overdue without implying provider failure', () => {
  const now = 1_800_000_000_000;
  const record = {
    state: 'CANCEL_REQUESTED',
    cancelRequestedAt: now - 25 * 60 * 60_000,
    nextAttemptAt: now - 60_000,
    cancellationReviewRequired: false,
    lastErrorCode: null,
  };
  const classification = inspectVideoProcessingJob(record, now);
  assert.equal(classification.cancellationOverdue24h, true);
  assert.equal(classification.cancellationReviewRequired, false);
  const summary = addVideoProcessingJobToInventory(
    createVideoProcessingInventory(), record, now
  );
  assert.equal(summary.cancellationScheduling.overdue24h, 1);
  assert.equal(summary.cancellationScheduling.reviewRequired, 0);

  assert.equal(inspectVideoProcessingJob({
    ...record, nextAttemptAt: now + 60_000,
  }, now).cancellationOverdue24h, false);
});

test('cancellation evidence distinguishes no submission, unknown provider and linked IDs', () => {
  const now = 1_800_000_000_000;
  const summary = createVideoProcessingInventory();
  const examples = [
    {
      attempts: 0, cancellationCleanupAttempts: 0,
      externalJobName: null, expectedProvider: 'NO_SUBMISSION_RECORDED',
      expectedCleanup: 'NO_FAILURE_RECORDED',
    },
    {
      attempts: 2, cancellationCleanupAttempts: 1,
      externalJobName: null, expectedProvider: 'SUBMISSION_POSSIBLY_EXTERNAL',
      expectedCleanup: 'FAILURES_RECORDED',
    },
    {
      attempts: 1, externalJobName: 'projects/secret/jobs/secret',
      expectedProvider: 'EXTERNAL_NAME_RECORDED',
      expectedCleanup: 'NO_RETRY_COUNTER',
    },
    {
      externalJobName: null, expectedProvider: 'UNKNOWN_SUBMISSION_HISTORY',
      expectedCleanup: 'NO_RETRY_COUNTER',
    },
  ];
  for (const e of examples) {
    const record = {
      ...e,
      state: 'CANCEL_REQUESTED',
      ownerUid: 'secret-owner',
      outputPrefix: 'users/secret-owner/processed/secret',
    };
    const result = inspectVideoProcessingJob(record, now);
    assert.equal(result.cancellationProviderTracking, e.expectedProvider);
    assert.equal(result.cancellationCleanupEvidence, e.expectedCleanup);
    addVideoProcessingJobToInventory(summary, record, now);
  }
  assert.deepEqual(summary.cancellationEvidence.providerTracking, {
    EXTERNAL_NAME_RECORDED: 1,
    NO_SUBMISSION_RECORDED: 1,
    SUBMISSION_POSSIBLY_EXTERNAL: 1,
    UNKNOWN_SUBMISSION_HISTORY: 1,
  });
  assert.deepEqual(summary.cancellationEvidence.cleanupHistory, {
    NO_RETRY_COUNTER: 2,
    NO_FAILURE_RECORDED: 1,
    FAILURES_RECORDED: 1,
  });
  const output = JSON.stringify(summary);
  assert.ok(!output.includes('secret-owner'));
  assert.ok(!output.includes('projects/secret'));
});

test('provider uncertainty is not confused with a confirmed failed cancellation', () => {
  const now = 1_800_000_000_000;
  const cases = [
    {
      state: 'CANCEL_REQUESTED',
      attempts: 2,
      lastErrorCode: 'CANCELLATION_UNCONFIRMED',
      cancellationCleanupAttempts: 2,
    },
    {
      state: 'CANCEL_REQUESTED',
      attempts: 0,
      lastErrorCode: 'ADMIN_CANCELLED',
      cancellationCleanupAttempts: 0,
    },
  ];
  const summary = createVideoProcessingInventory();
  for (const record of cases) {
    addVideoProcessingJobToInventory(summary, record, now);
  }
  assert.deepEqual(summary.cancellationEvidence.lastError, {
    PROVIDER_LOOKUP_UNCONFIRMED: 1,
    CLEANUP_FAILURE_RECORDED: 0,
    NO_CLEANUP_FAILURE_EVIDENCE: 1,
  });
  assert.equal(inspectVideoProcessingJob({
    state: 'SUCCEEDED', attempts: 1, externalJobName: 'secret',
  }, now).cancellationProviderTracking, null);
});

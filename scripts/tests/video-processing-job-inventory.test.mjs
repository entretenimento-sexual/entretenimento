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
    deferred: 1,
    missingDue: 1,
    invalidDue: 1,
    reviewRequired: 2,
  });
});

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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

// This contract must stay aligned with the production composite indexes.
// A bounded state-only query can repeatedly return not-yet-due jobs and starve
// eligible uploads or expired submission leases.
const scheduler = readFileSync(
  resolve(__dirname, '../../../src/media/application/video-processing.handler.ts'),
  'utf8'
);
const firestoreCore = readFileSync(
  resolve(__dirname, '../../../src/media/application/video-processing-reconciliation.firestore.ts'),
  'utf8'
);
const indexConfig = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../firestore.indexes.json'),
  'utf8'
)) as {
  indexes: Array<{
    collectionGroup: string;
    queryScope: string;
    fields: Array<{ fieldPath: string; order: string }>;
  }>;
};

function assertCompositeIndex(dueField: string): void {
  assert.ok(indexConfig.indexes.some(index =>
    index.collectionGroup === 'media_video_processing_jobs'
    && index.queryScope === 'COLLECTION'
    && index.fields[0]?.fieldPath === 'state'
    && index.fields[0]?.order === 'ASCENDING'
    && index.fields[1]?.fieldPath === dueField
    && index.fields[1]?.order === 'ASCENDING'
  ), 'Missing composite index for state + ' + dueField);
}

function assertDueQuery(
  state: 'QUEUED' | 'SUBMITTING',
  dueField: 'nextAttemptAt' | 'leaseUntil'
): void {
  const parts = [
    String.raw`\.where\('state', '==', '${state}'\)`,
    String.raw`\.where\('${dueField}', '<=', now\)`,
    String.raw`\.orderBy\('${dueField}', 'asc'\)`,
    String.raw`\.limit\(SUBMISSION_BATCH_SIZE\)`,
  ];
  assert.match(scheduler, new RegExp(parts.join(String.raw`\s*`)));
}

test('queued video jobs query due timestamps before applying the batch limit', () => {
  assertDueQuery('QUEUED', 'nextAttemptAt');
  assertCompositeIndex('nextAttemptAt');
});

test('submission recovery only selects expired leases before the batch limit', () => {
  assertDueQuery('SUBMITTING', 'leaseUntil');
  assertCompositeIndex('leaseUntil');
});

test('processing query only claims due jobs with a composite index', () => {
  const parts = [
    String.raw`\.where\('state', '==', 'PROCESSING'\)`,
    String.raw`\.where\('nextAttemptAt', '<=', now\)`,
    String.raw`\.orderBy\('nextAttemptAt', 'asc'\)`,
    String.raw`\.limit\(RECONCILIATION_BATCH_SIZE\)`,
  ];
  assert.match(firestoreCore, new RegExp(parts.join(String.raw`\s*`)));
  assert.ok(firestoreCore.includes('nextVideoProcessingPollAt(job, now)'));
  assert.ok(scheduler.includes('claimProcessingJob(db, jobDoc.ref, now, normalizeJob)'));
  assertCompositeIndex('nextAttemptAt');
});

test('reconciliation only persists meaningful provider status changes', () => {
  assert.ok(scheduler.includes('providerObservationChanged(job, providerJob.state)'));
  assert.ok(scheduler.includes('isCurrentVideoProcessingAttempt(current, job)'));
});

test('stale transcoder results cannot finalize or fail another processing attempt', () => {
  assert.ok(scheduler.includes('!isCurrentVideoProcessingAttempt(currentJob, job)'));
  assert.ok(scheduler.includes('!isCurrentVideoProcessingAttempt(current, job)'));
  assert.ok(scheduler.includes("state: 'CANCEL_REQUESTED'"));
});

test('transient provider errors cannot mutate cancelled or replaced jobs', () => {
  assert.ok(scheduler.includes(
    'current.lastErrorCode === normalized.code'
  ));
  assert.ok(scheduler.includes(
    '!isCurrentVideoProcessingAttempt(current, job)'
  ));
});

test('provider submission recovery supports processing jobs without external IDs', () => {
  assert.ok(scheduler.includes(
    "currentJob.state === 'PROCESSING' &&"
  ));
  assert.ok(scheduler.includes('!currentJob.externalJobName'));
});

test('cancelled job cleanup does not delete or resurrect a newer attempt', () => {
  const start = scheduler.indexOf('async function processCancellation(');
  const end = scheduler.indexOf('async function removeInvalidJob(', start);
  const body = scheduler.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(body.includes('deleteCancelledJobIfCurrent(db, jobRef, job, normalizeJob)'));
  assert.ok(body.includes('recordCancellationErrorIfCurrent('));
  assert.ok(firestoreCore.includes('isCurrentVideoCancellation(current, started)'));
  assert.ok(firestoreCore.includes('transaction.delete(jobRef)'));
  assert.ok(firestoreCore.includes('transaction.update(jobRef, {'));
  assert.ok(!body.includes('await jobRef.delete()'));
  assert.ok(!body.includes('await jobRef.set('));
});

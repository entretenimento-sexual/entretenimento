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
const transcoderService = readFileSync(
  resolve(__dirname, '../../../src/media/application/google-video-transcoder.service.ts'),
  'utf8'
);
const submissionConfirmationPolicy = readFileSync(
  resolve(__dirname, '../../../src/media/application/video-submission-confirmation.policy.ts'),
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
    String.raw`\.limit\(limit\)`,
  ];
  assert.match(firestoreCore, new RegExp(parts.join(String.raw`\s*`)));
  assert.ok(scheduler.includes('db, now, RECONCILIATION_BATCH_SIZE'));
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
  assert.ok(scheduler.includes('canAttachSubmittedProviderJob('));
  assert.ok(submissionConfirmationPolicy.includes(
    "return current.state === 'PROCESSING' &&"
  ));
  assert.ok(submissionConfirmationPolicy.includes(
    'current.nextAttemptAt === observed.nextAttemptAt;'
  ));
  assert.ok(firestoreCore.includes(
    'current.nextAttemptAt === observed.nextAttemptAt;'
  ));
});

test('cancelled job cleanup does not delete or resurrect a newer attempt', () => {
  const start = scheduler.indexOf('async function processCancellation(');
  const end = scheduler.indexOf('async function runBatch(', start);
  const body = scheduler.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(body.includes('executeVideoCancellation(job, {'));
  assert.ok(body.includes('deleteCancelledJobIfCurrent('));
  assert.ok(body.includes('recordCancellationErrorIfCurrent('));
  assert.ok(firestoreCore.includes('isCurrentCancellationClaim(current, started)'));
  assert.ok(firestoreCore.includes('transaction.delete(jobRef)'));
  assert.ok(!body.includes('await jobRef.delete()'));
  assert.ok(!body.includes('await jobRef.set('));
});

test('expired submission lookup uses a transactional lease claim', () => {
  assert.ok(scheduler.includes('claimExpiredSubmissionLease('));
  assert.ok(scheduler.includes('updateRecoveredSubmissionIfCurrent('));
  assert.ok(firestoreCore.includes('current.leaseUntil > now'));
  assert.ok(firestoreCore.includes('current.leaseUntil === observed.leaseUntil'));
  assert.ok(!scheduler.includes('await jobRef.update({\n        state: \'QUEUED\''));
});

test('submission failures use the same guarded transaction as recovery', () => {
  const start = scheduler.indexOf('async function handleSubmissionFailure(');
  const end = scheduler.indexOf('async function submitClaimedJob(', start);
  const body = scheduler.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(body.includes('updateRecoveredSubmissionIfCurrent('));
  assert.ok(!body.includes('await jobRef.update('));
  assert.ok(!body.includes('updatePrivateVideoIfPresent('));
  assert.ok(!scheduler.includes('async function updatePrivateVideoIfPresent('));
});

test('missing external submission never automatically returns a job to QUEUED', () => {
  const start = scheduler.indexOf('async function recoverExpiredSubmission(');
  const end = scheduler.indexOf('async function recoverExpiredSubmissionLeases(', start);
  const recovery = scheduler.slice(start, end);

  assert.ok(recovery.includes('decideMissingVideoSubmission(job, now)'));
  assert.ok(recovery.includes('confirming_submission'));
  assert.ok(!recovery.includes("state: 'QUEUED'"));
});

test('unknown provider cancellation uses the guarded execution core', () => {
  const start = scheduler.indexOf('async function processCancellation(');
  const end = scheduler.indexOf('async function runBatch(', start);
  const body = scheduler.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(body.includes('findProviderJob: findGoogleVideoTranscoderJob'));
  assert.ok(body.includes('bindCancelledProviderJobIfCurrent('));
  assert.ok(body.includes('deleteCancelledJobIfCurrent('));
  assert.ok(body.includes('executeVideoCancellation(job, {'));
});

test('successful POST without provider ID remains an ambiguous submission', () => {
  assert.ok(transcoderService.includes('class AmbiguousTranscoderSubmissionError'));
  assert.ok(transcoderService.includes(
    'throw new AmbiguousTranscoderSubmissionError()'
  ));
  assert.ok(transcoderService.includes("code: 'TRANSCODER_SUBMISSION_UNCONFIRMED'"));
  assert.ok(transcoderService.includes('retryable: true'));
});

test('cancelled jobs are claimed by due date before external cleanup', () => {
  const dueQuery = [
    String.raw`\.where\('state', '==', 'CANCEL_REQUESTED'\)`,
    String.raw`\.where\('nextAttemptAt', '<=', now\)`,
    String.raw`\.orderBy\('nextAttemptAt', 'asc'\)`,
    String.raw`\.limit\(limit\)`,
  ];
  assert.match(firestoreCore, new RegExp(dueQuery.join(String.raw`\s*`)));
  assert.ok(scheduler.includes(
    'queryDueCancelledJobs('
  ));
  assert.ok(scheduler.includes(
    'claimDueCancellation('
  ));
  assert.ok(firestoreCore.includes(
    'nextAttemptAt: nextCancellationRetryAt(attempts, now)'
  ));
  assert.ok(firestoreCore.includes('isCurrentCancellationClaim(current, started)'));
  assertCompositeIndex('nextAttemptAt');
});

test('malformed cancellation tracking documents are retained for review', () => {
  const start = scheduler.indexOf('export const cleanupCancelledVideoProcessing');
  const cleanup = scheduler.slice(start);

  assert.ok(start >= 0);
  assert.ok(!scheduler.includes('async function removeInvalidJob('));
  assert.ok(cleanup.includes('invalidCancellationCount += 1'));
  assert.ok(cleanup.includes('summarizeCancellationCycle('));
  assert.ok(cleanup.includes('invalidCancellationCount'));
  assert.ok(cleanup.includes('VIDEO_CANCELLATION_CYCLE_FINISHED'));
  assert.ok(!cleanup.includes('jobDoc.ref.delete('));
  assert.ok(!cleanup.includes('removeInvalidJob('));
});

test('invalid persisted provider ID never masquerades as a successful delete', () => {
  const start = transcoderService.indexOf(
    'export async function deleteGoogleVideoTranscoderJob('
  );
  const end = transcoderService.indexOf(
    'export function normalizeGoogleTranscoderError(', start
  );
  const deletion = transcoderService.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(deletion.includes(
    "throw new Error('Identificador do job de transcodificação inválido.')"
  ));
  assert.ok(deletion.indexOf('throw new Error(') <
    deletion.indexOf('const authorization = await authorizationHeader()'));
});

test('provider deletion uses the injectable idempotent-404 transport', () => {
  assert.ok(transcoderService.includes('deleteVideoTranscoderJobWithTransport('));
  assert.ok(transcoderService.includes('const authorization = await authorizationHeader()'));
  assert.ok(scheduler.includes('executeVideoCancellation(job, {'));
});

test('scheduler emits identifier-free cancellation cycle start and completion logs', () => {
  const cancel = scheduler.slice(
    scheduler.indexOf('export const cleanupCancelledVideoProcessing')
  );
  assert.ok(cancel.includes('VIDEO_CANCELLATION_CYCLE_STARTED'));
  assert.ok(cancel.includes('VIDEO_CANCELLATION_CYCLE_FINISHED'));
  assert.ok(cancel.includes('VIDEO_CANCELLATION_CYCLE_FAILED'));
  assert.ok(cancel.includes('summarizeCancellationCycle('));
  assert.ok(cancel.includes('await Promise.allSettled('));
  assert.ok(cancel.includes('cycleId'));
  assert.ok(cancel.includes('throw error;'));
  assert.ok(!cancel.includes('ownerUid:'));
  assert.ok(!cancel.includes('videoId:'));
  assert.ok(!cancel.includes("await runBatch(tasks, 'cancel')"));
});

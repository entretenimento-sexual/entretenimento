import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { buildQueuedVideoProcessingJob, type VideoProcessingJob } from './video-processing-job';
import { decideMissingVideoSubmission } from './video-submission-confirmation.policy';
import {
  backfillLegacyProcessingDueAt,
  claimProcessingJob,
  deleteCancelledJobIfCurrent,
  queryDueProcessingJobs,
  recordCancellationErrorIfCurrent,
  claimExpiredSubmissionLease,
  updateRecoveredSubmissionIfCurrent,
} from './video-processing-reconciliation.firestore';

const PROJECT_ID = 'demo-entretenimento-video-reconciliation';
const expectedHost = process.env.VIDEO_RECONCILE_EXPECTED_EMULATOR_HOST;
const host = process.env.FIRESTORE_EMULATOR_HOST;

assert.equal(process.env.GCLOUD_PROJECT, PROJECT_ID);
assert.match(String(host ?? ''), /^127\.0\.0\.1:\d{2,5}$/);
assert.equal(host, expectedHost);
assert.notEqual(host, '127.0.0.1:8080');
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, '');

const app = initializeApp({ projectId: PROJECT_ID }, 'video-reconciliation-e2e');
const firestore = getFirestore(app);
const jobs = firestore.collection('media_video_processing_jobs');
const now = 1_800_000_000_000;

after(async () => {
  await deleteApp(app);
});

function fixture(suffix: string): VideoProcessingJob {
  const uid = 'demo-reconciler';
  const videoId = 'vid-' + randomUUID();
  return {
    ...buildQueuedVideoProcessingJob({
      ownerUid: uid,
      videoId,
      sourceStoragePath: `users/${uid}/uploads/videos/${videoId}-source.mp4`,
      sourcePosterStoragePath: null,
      sourceMimeType: 'video/mp4',
      sourceSizeBytes: 10_000,
      sourceDurationMs: 10_000,
      now: now - 3 * 60_000,
    }),
    state: 'PROCESSING',
    providerState: suffix,
    externalJobName: 'projects/demo/locations/us-central1/jobs/' + videoId,
    submittedAt: now - 3 * 60_000,
    nextAttemptAt: now - 1_000,
  };
}
function parseJob(data: unknown): VideoProcessingJob | null {
  return data && typeof data === 'object' ? data as VideoProcessingJob : null;
}

test('due query selects earliest 20 and second batch after atomic claims', async () => {
  const prefix = 'due-' + randomUUID();
  const dueRefs = [];
  for (let i = 0; i < 25; i += 1) {
    const ref = jobs.doc(prefix + '-' + String(i).padStart(3, '0'));
    const job = fixture('RUNNING');
    await ref.set({ ...job, nextAttemptAt: now - 25_000 + i * 100 });
    dueRefs.push(ref);
  }
  const futureRef = jobs.doc(prefix + '-future');
  await futureRef.set({ ...fixture('PENDING'), nextAttemptAt: now + 60_000 });

  // The test collection is exclusively owned by this disposable emulator.
  const first = await queryDueProcessingJobs(firestore, now, 20).get();
  assert.equal(first.size, 20);
  assert.equal(first.docs[0].ref.id, dueRefs[0].id);

  const sameRef = first.docs[0].ref;
  const results = await Promise.all([
    claimProcessingJob(firestore, sameRef, now, parseJob),
    claimProcessingJob(firestore, sameRef, now, parseJob),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const claimed = (await sameRef.get()).data();
  assert.equal(claimed?.['updatedAt'], now - 3 * 60_000);
  assert.ok(Number(claimed?.['nextAttemptAt']) > now);

  for (const doc of first.docs.slice(1)) {
    assert.ok(await claimProcessingJob(firestore, doc.ref, now, parseJob));
  }
  const second = await queryDueProcessingJobs(firestore, now, 20).get();
  assert.equal(second.size, 5);
  assert.ok(second.docs.every(doc => doc.id !== futureRef.id));
});

test('legacy PROCESSING job requires an explicit version-checked backfill', async () => {
  const ref = jobs.doc('legacy-' + randomUUID());
  const original = fixture('RUNNING');
  const { nextAttemptAt: _ignored, ...legacy } = original;
  void _ignored;
  await ref.set(legacy);

  const dueBefore = await queryDueProcessingJobs(firestore, now, 50).get();
  assert.ok(!dueBefore.docs.some(doc => doc.id === ref.id));
  assert.equal(await backfillLegacyProcessingDueAt(
    firestore, ref, 'invalid-version', now
  ), false);
  assert.equal(await backfillLegacyProcessingDueAt(
    firestore, ref, original.processingVersion, now
  ), true);
  assert.equal(await backfillLegacyProcessingDueAt(
    firestore, ref, original.processingVersion, now
  ), false);

  const migrated = await ref.get();
  assert.equal(migrated.get('nextAttemptAt'), now);
  assert.equal(migrated.get('updatedAt'), original.updatedAt);
  assert.ok(await claimProcessingJob(firestore, ref, now, parseJob));

  const cancelledRef = jobs.doc('legacy-cancelled-' + randomUUID());
  await cancelledRef.set({ ...legacy, state: 'CANCEL_REQUESTED' });
  assert.equal(await backfillLegacyProcessingDueAt(
    firestore, cancelledRef, original.processingVersion, now
  ), false);
  assert.equal((await cancelledRef.get()).get('nextAttemptAt'), undefined);
});

test('delayed cancellation cannot delete, alter or recreate a newer attempt', async () => {
  const ref = jobs.doc('cancel-' + randomUUID());
  const original = { ...fixture('PENDING'), state: 'CANCEL_REQUESTED' as const };
  await ref.set(original);
  const newer = {
    ...fixture('RUNNING'),
    state: 'PROCESSING' as const,
  };
  await ref.set(newer);

  assert.equal(await deleteCancelledJobIfCurrent(
    firestore, ref, original, parseJob
  ), false);
  assert.equal(await recordCancellationErrorIfCurrent(
    firestore, ref, original, parseJob,
    { code: 'TIMEOUT', message: 'Late provider response' }, now
  ), false);
  assert.equal((await ref.get()).get('processingVersion'), newer.processingVersion);
  assert.equal((await ref.get()).get('lastErrorCode'), null);

  await ref.set(original);
  assert.equal(await deleteCancelledJobIfCurrent(
    firestore, ref, original, parseJob
  ), true);
  assert.equal((await ref.get()).exists, false);
  assert.equal(await recordCancellationErrorIfCurrent(
    firestore, ref, original, parseJob,
    { code: 'TIMEOUT', message: 'Late provider response' }, now
  ), false);
  assert.equal((await ref.get()).exists, false);
});

test('submission lease query excludes future leases before the batch limit', async () => {
  const expiredRef = jobs.doc('lease-expired-' + randomUUID());
  const futureRef = jobs.doc('lease-future-' + randomUUID());
  await expiredRef.set({
    ...fixture('PENDING'), state: 'SUBMITTING', leaseUntil: now - 1_000,
  });
  await futureRef.set({
    ...fixture('PENDING'), state: 'SUBMITTING', leaseUntil: now + 60_000,
  });
  const result = await jobs
    .where('state', '==', 'SUBMITTING')
    .where('leaseUntil', '<=', now)
    .orderBy('leaseUntil', 'asc')
    .limit(8)
    .get();
  assert.ok(result.docs.some(doc => doc.id === expiredRef.id));
  assert.ok(!result.docs.some(doc => doc.id === futureRef.id));
});

test('two competing submission recoveries claim only one expired lease', async () => {
  const ref = jobs.doc('recover-claim-' + randomUUID());
  const original = {
    ...fixture('PENDING'),
    state: 'SUBMITTING' as const,
    leaseUntil: now - 1_000,
  };
  await ref.set(original);
  const attempts = await Promise.all([
    claimExpiredSubmissionLease(firestore, ref, now, 300_000, parseJob),
    claimExpiredSubmissionLease(firestore, ref, now, 300_000, parseJob),
  ]);
  const claimed = attempts.filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal((await ref.get()).get('leaseUntil'), now + 300_000);

  const late = { ...claimed[0]!, leaseUntil: now - 1_000 };
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, late, parseJob, {
      now,
      jobPatch: { state: 'QUEUED', nextAttemptAt: now },
    }
  ), false);
  assert.equal((await ref.get()).get('state'), 'SUBMITTING');
});

test('recovery response cannot resurrect cancellation or overwrite new attempt', async () => {
  const ref = jobs.doc('recover-late-' + randomUUID());
  const old = {
    ...fixture('PENDING'),
    state: 'SUBMITTING' as const,
    leaseUntil: now + 300_000,
  };
  await ref.set(old);

  await ref.update({ state: 'CANCEL_REQUESTED', leaseUntil: null });
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, old, parseJob, {
      now,
      jobPatch: { state: 'QUEUED', nextAttemptAt: now },
    }
  ), false);
  assert.equal((await ref.get()).get('state'), 'CANCEL_REQUESTED');

  const newer = { ...fixture('RUNNING'), state: 'SUBMITTING' as const };
  await ref.set(newer);
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, old, parseJob, {
      now,
      jobPatch: { state: 'FAILED' },
    }
  ), false);
  assert.equal((await ref.get()).get('processingVersion'), newer.processingVersion);
});

test('a confirmed missing submission transitions job and video atomically', async () => {
  const jobRef = jobs.doc('recover-missing-' + randomUUID());
  const old = {
    ...fixture('PENDING'),
    state: 'SUBMITTING' as const,
    leaseUntil: now + 300_000,
  };
  const videoRef = firestore.doc(`users/${old.ownerUid}/videos/${old.videoId}`);
  await jobRef.set(old);
  await videoRef.set({ path: old.sourceStoragePath, status: 'processing' });

  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, jobRef, old, parseJob, {
      now,
      jobPatch: {
        state: 'QUEUED',
        leaseUntil: null,
        nextAttemptAt: now + 60_000,
      },
      videoPatch: { status: 'queued', processingStage: 'retry_wait' },
    }
  ), true);
  assert.equal((await jobRef.get()).get('state'), 'QUEUED');
  assert.equal((await videoRef.get()).get('processingStage'), 'retry_wait');

  // If the source file changes while a lookup is in flight, fail closed.
  await jobRef.set(old);
  await videoRef.update({ path: 'users/other/private/videos/other/source.mp4' });
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, jobRef, old, parseJob, {
      now,
      jobPatch: { state: 'QUEUED' },
      videoPatch: { status: 'queued' },
    }
  ), false);
  assert.equal((await jobRef.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await videoRef.get()).get('status'), 'queued');
});

test('late submit failure cannot override cancellation, retry or a new lease', async () => {
  const ref = jobs.doc('submit-error-' + randomUUID());
  const original = {
    ...fixture('PENDING'),
    state: 'SUBMITTING' as const,
    leaseUntil: now + 600_000,
  };
  const videoRef = firestore.doc(
    `users/${original.ownerUid}/videos/${original.videoId}`
  );
  await ref.set(original);
  await videoRef.set({
    path: original.sourceStoragePath,
    status: 'processing',
  });

  const update = {
    now,
    jobPatch: { state: 'FAILED', leaseUntil: null, lastErrorCode: 'HTTP_400' },
    videoPatch: { status: 'failed' },
  };

  // Cancelled during the original provider request.
  await ref.update({ state: 'CANCEL_REQUESTED' });
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, original, parseJob, update
  ), false);
  assert.equal((await ref.get()).get('state'), 'CANCEL_REQUESTED');
  assert.equal((await videoRef.get()).get('status'), 'processing');

  // A recovery worker takes over an expired submission before POST finishes.
  await ref.set({ ...original, leaseUntil: now + 900_000 });
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, original, parseJob, update
  ), false);
  assert.equal((await ref.get()).get('state'), 'SUBMITTING');

  // The last observed submit error belongs to an obsolete processing version.
  await ref.set({ ...original, processingVersion: 'new-attempt' });
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, original, parseJob, update
  ), false);
  assert.equal((await ref.get()).get('processingVersion'), 'new-attempt');

  // Only the live attempt may transition job and video in one transaction.
  await ref.set(original);
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, original, parseJob, update
  ), true);
  assert.equal((await ref.get()).get('state'), 'FAILED');
  assert.equal((await videoRef.get()).get('status'), 'failed');
});

test('negative provider lookup holds submission and never permits requeue', async () => {
  const ref = jobs.doc('confirm-negative-' + randomUUID());
  const current = {
    ...fixture('PENDING'),
    state: 'SUBMITTING' as const,
    leaseUntil: now + 300_000,
    submissionLookupMisses: 2,
  };
  const videoRef = firestore.doc(
    `users/${current.ownerUid}/videos/${current.videoId}`
  );
  await ref.set(current);
  await videoRef.set({ path: current.sourceStoragePath, status: 'processing' });
  const decision = decideMissingVideoSubmission(current, now);
  assert.equal(decision.leaseUntil, null);
  assert.equal(await updateRecoveredSubmissionIfCurrent(
    firestore, ref, current, parseJob, {
      now,
      jobPatch: { ...decision, updatedAt: now },
      videoPatch: {
        status: 'processing',
        processingStage: 'confirming_submission',
      },
    }
  ), true);
  assert.equal((await ref.get()).get('state'), 'SUBMITTING');
  assert.equal((await ref.get()).get('leaseUntil'), null);
  assert.equal((await ref.get()).get('lastErrorCode'), 'SUBMISSION_UNCONFIRMED');
  const due = await jobs.where('state', '==', 'SUBMITTING')
    .where('leaseUntil', '<=', now)
    .orderBy('leaseUntil', 'asc').get();
  assert.ok(!due.docs.some(doc => doc.id === ref.id));
});

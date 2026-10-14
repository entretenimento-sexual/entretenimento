import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import {
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';
import { nextVideoProcessingPollAt, isCurrentVideoCancellation } from './video-processing-poll.policy';

type NormalizeJob = (data: unknown) => VideoProcessingJob | null;

/** Production and tests share the same indexed query, not a test-only copy. */
export function queryDueProcessingJobs(
  firestore: Firestore,
  now: number,
  limit: number
) {
  return firestore
    .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .where('state', '==', 'PROCESSING')
    .where('nextAttemptAt', '<=', now)
    .orderBy('nextAttemptAt', 'asc')
    .limit(limit);
}

/** Atomic poll reservation: overlapping schedulers cannot poll twice. */
export async function claimProcessingJob(
  firestore: Firestore,
  jobRef: DocumentReference,
  now: number,
  normalizeJob: NormalizeJob
): Promise<VideoProcessingJob | null> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const job = snapshot.exists ? normalizeJob(snapshot.data()) : null;

    if (!job || job.state !== 'PROCESSING' || job.nextAttemptAt > now) {
      return null;
    }

    transaction.update(jobRef, {
      nextAttemptAt: nextVideoProcessingPollAt(job, now),
    });
    return job;
  });
}

/**
 * Legacy PROCESSING documents may lack nextAttemptAt and are invisible to
 * range queries. This one-document repair is deliberately not called by the
 * periodic scheduler: migration requires an explicit, separately reviewed run.
 */
export async function backfillLegacyProcessingDueAt(
  firestore: Firestore,
  jobRef: DocumentReference,
  expectedVersion: string,
  now: number
): Promise<boolean> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) return false;

    const data = snapshot.data() ?? {};
    if (
      data['state'] !== 'PROCESSING' ||
      data['processingVersion'] !== expectedVersion ||
      Object.prototype.hasOwnProperty.call(data, 'nextAttemptAt')
    ) {
      return false;
    }

    transaction.update(jobRef, { nextAttemptAt: now });
    return true;
  });
}

/** Only remove the precise cancellation that was cleaned externally. */
export async function deleteCancelledJobIfCurrent(
  firestore: Firestore,
  jobRef: DocumentReference,
  started: VideoProcessingJob,
  normalizeJob: NormalizeJob
): Promise<boolean> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const current = snapshot.exists ? normalizeJob(snapshot.data()) : null;

    if (!isCurrentVideoCancellation(current, started)) return false;
    transaction.delete(jobRef);
    return true;
  });
}

/** A delayed cleanup failure must neither recreate nor change newer jobs. */
export async function recordCancellationErrorIfCurrent(
  firestore: Firestore,
  jobRef: DocumentReference,
  started: VideoProcessingJob,
  normalizeJob: NormalizeJob,
  error: { code: string; message: string },
  now: number
): Promise<boolean> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const current = snapshot.exists ? normalizeJob(snapshot.data()) : null;

    if (!isCurrentVideoCancellation(current, started)) return false;
    transaction.update(jobRef, {
      updatedAt: now,
      lastErrorCode: error.code,
      lastError: error.message,
    });
    return true;
  });
}

import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import {
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';
import {
  nextVideoProcessingPollAt,
  isCurrentVideoProcessingAttempt,
} from './video-processing-poll.policy';
import { nextProviderPollFailure } from './video-provider-poll-failure.policy';
import {
  CANCELLATION_RESERVATION_MS,
  cancellationNeedsReview,
  isCurrentCancellationClaim,
  nextCancellationRetryAt,
} from './video-cancellation-schedule.policy';
import { extractOwnedPrivateVideoPathForId } from './video-storage-path';
import { canSubmitCurrentTranscoderJob } from './video-transcoder-post-guard.policy';

type NormalizeJob = (data: unknown) => VideoProcessingJob | null;

/** Read-only transaction; never reserve a second submission or issue a POST. */
export async function confirmTranscoderPostIsCurrent(
  firestore: Firestore,
  jobRef: DocumentReference,
  observed: VideoProcessingJob,
  normalizeJob: NormalizeJob,
  now: number,
  immutableRequired: boolean
): Promise<boolean> {
  const videoRef = firestore.doc(
    `users/${observed.ownerUid}/videos/${observed.videoId}`
  );
  return firestore.runTransaction(async transaction => {
    const [jobSnap, videoSnap] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(videoRef),
    ]);
    return canSubmitCurrentTranscoderJob(
      jobSnap.exists ? normalizeJob(jobSnap.data()) : null,
      observed,
      videoSnap.exists ? videoSnap.data() ?? null : null,
      now,
      immutableRequired
    );
  });
}

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

    const reservedUntil = nextVideoProcessingPollAt(job, now);
    transaction.update(jobRef, { nextAttemptAt: reservedUntil });
    return { ...job, nextAttemptAt: reservedUntil };
  });
}

/**
 * A failed provider GET does not establish a terminal provider state.
 * Preserve PROCESSING and its next poll reservation even for HTTP 403/404.
 */
export async function recordProviderPollErrorIfCurrent(
  firestore: Firestore,
  jobRef: DocumentReference,
  observed: VideoProcessingJob,
  normalizeJob: NormalizeJob,
  error: { code: string; message: string; retryable?: boolean },
  now: number
): Promise<boolean> {
  return firestore.runTransaction(async transaction => {
    const snap = await transaction.get(jobRef);
    const current = snap.exists ? normalizeJob(snap.data()) : null;
    if (!current || !isCurrentVideoProcessingAttempt(current, observed)) {
      return false;
    }
    const decision = nextProviderPollFailure(current, now, error.retryable === true);
    transaction.update(jobRef, {
      ...decision,
      updatedAt: now,
      lastErrorCode: error.code,
      lastError: error.message,
    });
    return true;
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

/** Range filter + sort prevent deferred cancellations from starving due jobs. */
export function queryDueCancelledJobs(
  firestore: Firestore,
  now: number,
  limit: number
) {
  return firestore
    .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .where('state', '==', 'CANCEL_REQUESTED')
    .where('nextAttemptAt', '<=', now)
    .orderBy('nextAttemptAt', 'asc')
    .limit(limit);
}

/**
 * Acquire a cancellation before any Transcoder or Storage call. The clock
 * reservation also fences stale completions and concurrent schedulers.
 */
export async function claimDueCancellation(
  firestore: Firestore,
  jobRef: DocumentReference,
  now: number,
  normalizeJob: NormalizeJob
): Promise<VideoProcessingJob | null> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const current = snapshot.exists ? normalizeJob(snapshot.data()) : null;
    if (
      !current ||
      current.state !== 'CANCEL_REQUESTED' ||
      current.nextAttemptAt > now
    ) {
      return null;
    }

    const reservedAt = now + CANCELLATION_RESERVATION_MS;
    transaction.update(jobRef, { nextAttemptAt: reservedAt });
    return { ...current, nextAttemptAt: reservedAt };
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

    if (!isCurrentCancellationClaim(current, started)) return false;
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

    if (!isCurrentCancellationClaim(current, started)) return false;
    const attempts = (current?.cancellationCleanupAttempts ?? 0) + 1;
    transaction.update(jobRef, {
      cancellationCleanupAttempts: attempts,
      cancellationReviewRequired: current?.cancellationReviewRequired === true ||
        cancellationNeedsReview(attempts, error.code),
      nextAttemptAt: nextCancellationRetryAt(attempts, now),
      updatedAt: now,
      lastErrorCode: error.code,
      lastError: error.message,
    });
    return true;
  });
}

/**
 * Expired SUBMITTING jobs require an atomic lease claim before any external
 * provider lookup. Returning the claimed lease provides a fencing token for
 * the completion transaction, including when the external lookup is delayed.
 */
export async function claimExpiredSubmissionLease(
  firestore: Firestore,
  jobRef: DocumentReference,
  now: number,
  recoveryLeaseMs: number,
  normalizeJob: NormalizeJob
): Promise<VideoProcessingJob | null> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const current = snapshot.exists ? normalizeJob(snapshot.data()) : null;

    if (
      !current ||
      current.state !== 'SUBMITTING' ||
      current.leaseUntil === null ||
      current.leaseUntil > now
    ) {
      return null;
    }

    const reservedUntil = now + recoveryLeaseMs;
    transaction.update(jobRef, { leaseUntil: reservedUntil });
    return { ...current, leaseUntil: reservedUntil };
  });
}

/** A delayed provider result must not undo cancellation, retry, or new leases. */
export function isCurrentSubmissionRecovery(
  current: VideoProcessingJob | null,
  observed: VideoProcessingJob
): boolean {
  if (
    !current ||
    current.processingVersion !== observed.processingVersion ||
    current.attempts !== observed.attempts ||
    current.sourceStoragePath !== observed.sourceStoragePath
  ) {
    return false;
  }

  if (observed.state === 'SUBMITTING') {
    return current.state === 'SUBMITTING' &&
      current.leaseUntil !== null &&
      current.leaseUntil === observed.leaseUntil;
  }

  // Processing without an external job name is recovered through the same
  // function, but its polling reservation uses nextAttemptAt, not a lease.
  return observed.state === 'PROCESSING' &&
    current.state === 'PROCESSING' &&
    !current.externalJobName &&
    current.nextAttemptAt === observed.nextAttemptAt;
}

interface RecoveredSubmissionUpdate {
  jobPatch: Record<string, unknown>;
  videoPatch?: Record<string, unknown>;
  now: number;
}

/** Apply the job and associated video transition together, or neither. */
export async function updateRecoveredSubmissionIfCurrent(
  firestore: Firestore,
  jobRef: DocumentReference,
  observed: VideoProcessingJob,
  normalizeJob: NormalizeJob,
  update: RecoveredSubmissionUpdate
): Promise<boolean> {
  const videoRef = firestore.doc(
    `users/${observed.ownerUid}/videos/${observed.videoId}`
  );
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const current = snapshot.exists ? normalizeJob(snapshot.data()) : null;
    if (!isCurrentSubmissionRecovery(current, observed)) return false;

    if (update.videoPatch) {
      const videoSnapshot = await transaction.get(videoRef);
      const video = videoSnapshot.exists ? videoSnapshot.data() ?? {} : null;
      const source = video
        ? (
          extractOwnedPrivateVideoPathForId(
            observed.ownerUid, observed.videoId, video['path']
          ) ??
          extractOwnedPrivateVideoPathForId(
            observed.ownerUid, observed.videoId, video['url']
          )
        )
        : null;

      if (source !== observed.sourceStoragePath) {
        transaction.update(jobRef, {
          state: 'CANCEL_REQUESTED',
          cancelRequestedAt: update.now,
          nextAttemptAt: update.now,
          leaseUntil: null,
          updatedAt: update.now,
          lastErrorCode: 'SOURCE_CHANGED',
          lastError: 'A fonte privada mudou durante a recuperação.',
        });
        return false;
      }
    }

    transaction.update(jobRef, update.jobPatch);
    if (update.videoPatch) {
      transaction.set(videoRef, update.videoPatch, { merge: true });
    }
    return true;
  });
}

/**
 * Once a formerly unknown provider job is found, persist its identity before
 * performing external deletion. A cleanup failure can then safely retry by ID.
 */
export async function bindCancelledProviderJobIfCurrent(
  firestore: Firestore,
  jobRef: DocumentReference,
  started: VideoProcessingJob,
  providerJobName: string,
  normalizeJob: NormalizeJob,
  now: number
): Promise<boolean> {
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const current = snapshot.exists ? normalizeJob(snapshot.data()) : null;

    if (
      !isCurrentCancellationClaim(current, started) ||
      (current?.externalJobName && current.externalJobName !== providerJobName)
    ) {
      return false;
    }

    transaction.update(jobRef, {
      externalJobName: providerJobName,
      updatedAt: now,
      lastErrorCode: null,
      lastError: null,
    });
    return true;
  });
}

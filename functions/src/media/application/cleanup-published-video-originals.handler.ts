import { randomUUID } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { db, storage } from '../../firebaseApp';
import {
  claimVideoDeletionJob,
  settleVideoDeletionJob,
} from './video-deletion-queue.firestore';
import {
  deleteGenerationPinnedVideoFile,
  VideoDeletionGenerationConflictError,
} from './video-deletion-storage-pages';
import {
  mayDeletePublishedVideoOriginal,
  VIDEO_ORIGINAL_CLEANUP_COLLECTION,
  type VideoOriginalCleanupJob,
  videoOriginalCleanupJobId,
} from './video-original-cleanup.policy';

const BATCH_SIZE = 40;

function shortError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? 'unknown'))
    .slice(0, 500);
}

async function cleanOriginal(
  jobRef: FirebaseFirestore.DocumentReference
): Promise<void> {
  const token = randomUUID();
  const job = await claimVideoDeletionJob<VideoOriginalCleanupJob>(
    db, jobRef, Date.now(), token
  );
  if (!job) return;

  try {
    if (jobRef.id !== videoOriginalCleanupJobId(job.ownerUid, job.videoId)) {
      throw new VideoDeletionGenerationConflictError('Invalid cleanup job identity.');
    }

    const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);
    const publicationRef = db.doc(
      `users/${job.ownerUid}/video_publications/${job.videoId}`
    );
    const processingRef = db.collection('media_video_processing_jobs')
      .doc(`${job.ownerUid}_${job.videoId}`);
    const deletingRef = db.collection('media_video_deletion_jobs')
      .doc(`${job.ownerUid}_${job.videoId}`);

    const [video, publication, processing, deleting] = await Promise.all([
      videoRef.get(), publicationRef.get(), processingRef.get(), deletingRef.get(),
    ]);

    if (deleting.exists) {
      // Profile removal owns the cleanup. No second worker may race with it.
      await settleVideoDeletionJob(db, jobRef, token, { kind: 'COMPLETED' });
      return;
    }
    if (!mayDeletePublishedVideoOriginal(
      job,
      video.exists ? video.data() ?? null : null,
      publication.exists ? publication.data() ?? null : null,
      processing.exists ? processing.data() ?? null : null
    )) {
      throw new VideoDeletionGenerationConflictError(
        'Original cleanup eligibility changed; manual review required.'
      );
    }

    const publishedFile = storage.bucket().file(job.publishedStoragePath);
    const [publishedExists] = await publishedFile.exists();
    if (!publishedExists) {
      throw new Error('Published copy not yet available.');
    }

    // Do not begin GCS deletion if another worker already owns this lease.
    const lease = await jobRef.get();
    if (!lease.exists || lease.get('leaseToken') !== token ||
        typeof lease.get('leaseUntil') !== 'number' ||
        lease.get('leaseUntil') <= Date.now()) return;

    await deleteGenerationPinnedVideoFile(job.sourceGeneration, generation =>
      storage.bucket().file(job.sourceStoragePath).delete({
        ignoreNotFound: true,
        ifGenerationMatch: generation,
      })
    );

    await settleVideoDeletionJob(db, jobRef, token, { kind: 'COMPLETED' });
  } catch (error) {
    const blocked = error instanceof VideoDeletionGenerationConflictError;
    const outcome = await settleVideoDeletionJob(db, jobRef, token,
      blocked ? { kind: 'BLOCKED', error: shortError(error) } :
        { kind: 'RETRYABLE_FAILURE', error: shortError(error) }
    );
    logger.warn('[videoOriginalCleanup] Original retido ou limpeza reagendada.', {
      status: outcome,
      blocked,
      reason: shortError(error),
    });
  }
}

/** Piggybacks on the existing hourly deletion scheduler: no new Cloud Scheduler fee. */
export async function processPendingVideoOriginalCleanupJobs(): Promise<void> {
  const snapshot = await db.collection(VIDEO_ORIGINAL_CLEANUP_COLLECTION)
    .where('nextAttemptAt', '<=', Date.now())
    .orderBy('nextAttemptAt')
    .limit(BATCH_SIZE)
    .get();
  for (const candidate of snapshot.docs) {
    try {
      await cleanOriginal(candidate.ref);
    } catch (error) {
      logger.error('[videoOriginalCleanup] Falha de processamento.', {
        reason: shortError(error),
      });
    }
  }
}

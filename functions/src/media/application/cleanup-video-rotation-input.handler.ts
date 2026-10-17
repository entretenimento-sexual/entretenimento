import { createHash, randomUUID } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';
import { buildRotationSourceStoragePath } from './video-rotation-worker.service';
import { deleteGenerationPinnedVideoFile } from './video-deletion-storage-pages';
import {
  cleanupTerminalVideoTemporaryAssets,
  hasTerminalTemporaryAssets,
  isConfirmedTerminalVideoJob,
  VIDEO_TERMINAL_TEMP_CLEANUP_COLLECTION,
} from './video-terminal-temporary-cleanup.policy';

interface TerminalCleanupQueue {
  jobId: string;
  processingVersion: string;
  state: 'retryable' | 'done' | 'review';
  attempts: number;
  nextAttemptAt: number | null;
  leaseToken: string | null;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
}

const CLEANUP_BATCH_SIZE = 12;
const CLEANUP_LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 8;

function cleanupQueueId(jobId: string, version: string): string {
  return createHash('sha256').update(JSON.stringify([jobId, version])).digest('hex');
}

function terminalState(state: unknown): boolean {
  return state === 'SUCCEEDED' || state === 'FAILED';
}

function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 6 || error.code === '6' ||
    error.code === 'already-exists';
}

async function enqueueTerminalCleanup(jobId: string, job: VideoProcessingJob): Promise<void> {
  if (!terminalState(job.state) || !hasTerminalTemporaryAssets(job) ||
      buildVideoProcessingJobId(job.ownerUid, job.videoId) !== jobId ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(job.processingVersion)) return;
  const now = Date.now();
  const queue: TerminalCleanupQueue = {
    jobId, processingVersion: job.processingVersion,
    state: 'retryable', attempts: 0, nextAttemptAt: now,
    leaseToken: null, createdAt: now, updatedAt: now, lastError: null,
  };
  try {
    await db.collection(VIDEO_TERMINAL_TEMP_CLEANUP_COLLECTION)
      .doc(cleanupQueueId(jobId, job.processingVersion)).create(queue);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
}

function matchesCurrentJob(job: VideoProcessingJob | null, queue: TerminalCleanupQueue): boolean {
  return !!job &&
    buildVideoProcessingJobId(job.ownerUid, job.videoId) === queue.jobId &&
    job.processingVersion === queue.processingVersion &&
    terminalState(job.state) &&
    hasTerminalTemporaryAssets(job) &&
    isConfirmedTerminalVideoJob(job);
}

async function processCleanupDoc(
  queueRef: DocumentReference, now: number
): Promise<void> {
  const claimed = await db.runTransaction(async transaction => {
    const snap = await transaction.get(queueRef);
    if (!snap.exists) return null;
    const queue = snap.data() as TerminalCleanupQueue;
    if (queue.state !== 'retryable' ||
        typeof queue.nextAttemptAt !== 'number' ||
        queue.nextAttemptAt > now) return null;
    const jobRef = db.collection(VIDEO_PROCESSING_JOBS_COLLECTION).doc(queue.jobId);
    const jobSnap = await transaction.get(jobRef);
    const job = jobSnap.exists ? jobSnap.data() as VideoProcessingJob : null;
    if (!matchesCurrentJob(job, queue)) {
      transaction.update(queueRef, {
        state: 'review', nextAttemptAt: null, leaseToken: null,
        updatedAt: now, lastError: 'VIDEO_TEMP_CLEANUP_JOB_NOT_CONFIRMED',
      });
      return null;
    }
    const token = randomUUID();
    transaction.update(queueRef, {
      leaseToken: token, nextAttemptAt: now + CLEANUP_LEASE_MS,
      updatedAt: now,
    });
    return { job: job!, jobRef, token, queue };
  });
  if (!claimed) return;

  const { job, jobRef, token, queue } = claimed;
  const claimIsCurrent = async (): Promise<boolean> => {
    const [queueSnap, jobSnap] = await Promise.all([queueRef.get(), jobRef.get()]);
    const pending = queueSnap.exists ? queueSnap.data() as TerminalCleanupQueue : null;
    return !!pending && pending.state === 'retryable' &&
      pending.leaseToken === token &&
      typeof pending.nextAttemptAt === 'number' &&
      pending.nextAttemptAt > Date.now() &&
      matchesCurrentJob(jobSnap.exists ? jobSnap.data() as VideoProcessingJob : null, queue);
  };
  let done = false;
  let failure: unknown = null;
  try {
    const bucket = storage.bucket();
    done = await cleanupTerminalVideoTemporaryAssets(job, {
      claimIsCurrent,
      async readObject(path) {
        try {
          const [metadata] = await bucket.file(path).getMetadata();
          return metadata;
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error &&
              Number(error.code) === 404) return null;
          throw error;
        }
      },
      deletePinned: (path, generation) =>
        deleteGenerationPinnedVideoFile(generation, pinned =>
          bucket.file(path).delete({ ifGenerationMatch: pinned, ignoreNotFound: true })
        ),
    });
  } catch (error) {
    failure = error;
  }

  const finishedAt = Date.now();
  const message = failure instanceof Error ? failure.message :
    failure === null ? 'VIDEO_TEMP_CLEANUP_CLAIM_LOST' : String(failure);
  const permanent = /PROVENANCE_CONFLICT|INVALID_|PROVIDER_UNCONFIRMED|GENERATION_CONFLICT/i
    .test(message);
  await db.runTransaction(async transaction => {
    const snap = await transaction.get(queueRef);
    const current = snap.exists ? snap.data() as TerminalCleanupQueue : null;
    if (!current || current.leaseToken !== token || current.state !== 'retryable') return;
    const attempts = current.attempts + (done ? 0 : 1);
    const review = !done && (permanent || attempts >= MAX_ATTEMPTS);
    const delay = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(6, attempts));
    transaction.update(queueRef, {
      state: done ? 'done' : review ? 'review' : 'retryable',
      attempts,
      nextAttemptAt: done || review ? null : finishedAt + delay,
      leaseToken: null,
      updatedAt: finishedAt,
      lastError: done ? null : message.slice(0, 350),
    });
  });
  if (done) {
    logger.info('[videoTempCleanup] Temporários removidos.', {
      jobId: queue.jobId, processingVersion: queue.processingVersion,
    });
  } else {
    logger.warn('[videoTempCleanup] Temporários retidos; retentativa ou revisão.', {
      jobId: queue.jobId, processingVersion: queue.processingVersion,
      attempts: queue.attempts + 1, error: message.slice(0, 350),
    });
  }
}

/** Executed by the existing five-minute video reconciliation schedule. */
export async function processPendingVideoTerminalTemporaryCleanup(): Promise<void> {
  const now = Date.now();
  const snapshot = await db.collection(VIDEO_TERMINAL_TEMP_CLEANUP_COLLECTION)
    .where('nextAttemptAt', '<=', now)
    .orderBy('nextAttemptAt', 'asc')
    .limit(CLEANUP_BATCH_SIZE)
    .get();
  for (const item of snapshot.docs) {
    try {
      await processCleanupDoc(item.ref, Date.now());
    } catch (error) {
      logger.error('[videoTempCleanup] Falha ao registrar processamento da fila.', {
        queueId: item.id,
        error: error instanceof Error ? error.message.slice(0, 350) : String(error),
      });
      throw error;
    }
  }
}

interface RotationCleanupJobSnapshot {
  ownerUid?: string;
  videoId?: string;
  processingVersion?: string;
  state?: string;
  editRecipe?: VideoProcessingJob['editRecipe'];
  immutableInput?: unknown;
}

function legacyHasRotation(job: RotationCleanupJobSnapshot): boolean {
  const rotation = job.editRecipe?.rotationDegrees;
  return rotation === 90 || rotation === 180 || rotation === 270;
}

/**
 * Terminal transitions enqueue version-fenced cleanup, never mutable-path deletion.
 * Preserve the existing cancellation/deletion behavior for legacy rotation jobs.
 */
export const cleanupVideoRotationInput = onDocumentWritten(
  { document: 'media_video_processing_jobs/{jobId}', region: FUNCTIONS_REGION, retry: true },
  async event => {
    const before = event.data?.before.exists
      ? event.data.before.data() as RotationCleanupJobSnapshot : null;
    const after = event.data?.after.exists
      ? event.data.after.data() as RotationCleanupJobSnapshot : null;
    if (after && terminalState(after.state)) {
      await enqueueTerminalCleanup(event.params.jobId, after as VideoProcessingJob);
      return;
    }
    const candidate = after ?? before;
    if (!candidate || !legacyHasRotation(candidate) ||
        (after && after.state !== 'CANCELLED') ||
        candidate.immutableInput != null) return;
    try {
      const path = buildRotationSourceStoragePath(
        candidate as Pick<VideoProcessingJob, 'ownerUid' | 'videoId' | 'processingVersion'>
      );
      // Pre-existing cancellation/deletion contract for legacy (no immutable snapshot).
      await storage.bucket().file(path).delete({ ignoreNotFound: true });
    } catch (error) {
      logger.warn('[videoRotationCleanup] Temporário legado pendente.', {
        jobId: event.params.jobId,
        error: error instanceof Error ? error.message.slice(0, 350) : String(error),
      });
    }
  }
);

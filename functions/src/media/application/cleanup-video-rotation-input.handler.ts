/**
 * Terminal video temporary cleanup: immutable Firestore queue records and
 * generation-pinned GCS deletion. Cancellation uses the same strict policy.
 */
import * as logger from 'firebase-functions/logger';
import type { DocumentReference } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import type { VideoProcessingJob } from './video-processing-job';
import { deleteGenerationPinnedVideoFile } from './video-deletion-storage-pages';
import {
  cleanupCancelledRotationTemporaryAsset,
  cleanupTerminalVideoTemporaryAssets,
  VIDEO_TERMINAL_TEMP_CLEANUP_COLLECTION,
  type TerminalTemporaryCleanupPorts,
} from './video-terminal-temporary-cleanup.policy';
import {
  buildTerminalCleanupQueue,
  claimDueTerminalTemporaryCleanup,
  isTerminalTemporaryClaimCurrent,
  terminalCleanupRef,
  type TerminalCleanupQueue,
} from './video-terminal-temporary-cleanup.firestore';

const CLEANUP_BATCH_SIZE = 12;
const MAX_ATTEMPTS = 8;

function isAlreadyExists(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error &&
    (error.code === 6 || error.code === '6' || error.code === 'already-exists');
}

function storagePorts(claimIsCurrent: () => Promise<boolean>): TerminalTemporaryCleanupPorts {
  const bucket = storage.bucket();
  return {
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
  };
}

/** Called only by cancellation execution after confirmed provider deletion. */
export async function deleteCancelledRotationInput(
  job: VideoProcessingJob, claimIsCurrent: () => Promise<boolean>
): Promise<boolean> {
  return cleanupCancelledRotationTemporaryAsset(job, storagePorts(claimIsCurrent));
}

async function enqueueTerminalCleanup(jobId: string, job: VideoProcessingJob): Promise<void> {
  const prepared = buildTerminalCleanupQueue(jobId, job, Date.now());
  if (!prepared) return;
  try {
    await terminalCleanupRef(db, jobId, prepared.processingVersion).create(prepared);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
}

async function processCleanupDoc(
  queueRef: DocumentReference, now: number
): Promise<void> {
  const claimed = await claimDueTerminalTemporaryCleanup(db, queueRef, now);
  if (!claimed) return;

  let completed = false;
  let failure: unknown = null;
  try {
    completed = await cleanupTerminalVideoTemporaryAssets(
      claimed.snapshot,
      storagePorts(() => isTerminalTemporaryClaimCurrent(queueRef, claimed, Date.now()))
    );
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
    if (!current || current.leaseToken !== claimed.token ||
        current.state !== 'retryable') return;
    const attempts = current.attempts + (completed ? 0 : 1);
    const review = !completed && (permanent || attempts >= MAX_ATTEMPTS);
    const delay = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(6, attempts));
    transaction.update(queueRef, {
      state: completed ? 'done' : review ? 'review' : 'retryable',
      attempts, nextAttemptAt: completed || review ? null : finishedAt + delay,
      leaseToken: null, updatedAt: finishedAt,
      lastError: completed ? null : message.slice(0, 350),
    });
  });
  logger[completed ? 'info' : 'warn']('[videoTempCleanup] Ciclo finalizado.', {
    jobId: claimed.queue.jobId,
    processingVersion: claimed.queue.processingVersion,
    status: completed ? 'DONE' : 'RETRY_OR_REVIEW',
    error: completed ? null : message.slice(0, 350),
  });
}

/** Existing 5-minute reconciliation schedule owns the durable queue. */
export async function processPendingVideoTerminalTemporaryCleanup(): Promise<void> {
  const now = Date.now();
  const snapshot = await db.collection(VIDEO_TERMINAL_TEMP_CLEANUP_COLLECTION)
    .where('nextAttemptAt', '<=', now)
    .orderBy('nextAttemptAt', 'asc')
    .limit(CLEANUP_BATCH_SIZE).get();
  for (const item of snapshot.docs) {
    try {
      await processCleanupDoc(item.ref, Date.now());
    } catch (error) {
      logger.error('[videoTempCleanup] Falha na fila.', {
        queueId: item.id,
        error: error instanceof Error ? error.message.slice(0, 350) : String(error),
      });
      throw error;
    }
  }
}

/**
 * Never delete a legacy rotation by mutable path on Firestore events.
 * Cancellation is handled in its existing durable scheduler, after provider
 * deletion and with generation-pinned, provenance-checked GCS deletion.
 */
export const cleanupVideoRotationInput = onDocumentWritten(
  { document: 'media_video_processing_jobs/{jobId}', region: FUNCTIONS_REGION, retry: true },
  async event => {
    if (!event.data?.after.exists) return;
    const job = event.data.after.data() as VideoProcessingJob;
    await enqueueTerminalCleanup(event.params.jobId, job);
  }
);

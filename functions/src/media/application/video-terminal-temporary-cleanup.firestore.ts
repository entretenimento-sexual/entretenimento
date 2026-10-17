/**
 * Durable, version-keyed temporary cleanup snapshots. A retry may replace the
 * live job document; only the terminal version's immutable snapshot is trusted.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import {
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';
import {
  hasTerminalTemporaryAssets,
  isConfirmedTerminalVideoJob,
  VIDEO_TERMINAL_TEMP_CLEANUP_COLLECTION,
  type TerminalTempCleanupJob,
} from './video-terminal-temporary-cleanup.policy';

export interface TerminalCleanupQueue {
  jobId: string;
  processingVersion: string;
  snapshot?: TerminalTempCleanupJob;
  state: 'retryable' | 'done' | 'review';
  attempts: number;
  nextAttemptAt: number | null;
  leaseToken: string | null;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
}

export const TERMINAL_TEMP_CLEANUP_LEASE_MS = 10 * 60_000;

export function terminalCleanupQueueId(jobId: string, version: string): string {
  return createHash('sha256').update(JSON.stringify([jobId, version])).digest('hex');
}

export function buildTerminalCleanupQueue(
  jobId: string, job: VideoProcessingJob, now: number
): TerminalCleanupQueue | null {
  if ((job.state !== 'SUCCEEDED' && job.state !== 'FAILED') ||
      !hasTerminalTemporaryAssets(job) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(job.ownerUid) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(job.videoId) ||
      buildVideoProcessingJobId(job.ownerUid, job.videoId) !== jobId ||
      !/^[A-Za-z0-9_-]{1,160}$/.test(job.processingVersion) ||
      !Number.isSafeInteger(now) || now <= 0) return null;

  const snapshot: TerminalTempCleanupJob = {
    ownerUid: job.ownerUid, videoId: job.videoId,
    processingVersion: job.processingVersion, state: job.state,
    providerState: job.providerState ?? null,
    externalJobName: job.externalJobName ?? null,
    attempts: job.attempts,
    sourceStoragePath: job.sourceStoragePath,
    sourceGeneration: job.sourceGeneration ?? null,
    sourceSizeBytes: job.sourceSizeBytes,
    sourceMimeType: job.sourceMimeType,
    sourceProbe: job.sourceProbe ?? null,
    immutableInput: job.immutableInput ?? null,
    ...(job.editRecipe ? { editRecipe: job.editRecipe } : {}),
  };
  return {
    jobId, processingVersion: job.processingVersion, snapshot,
    state: 'retryable', attempts: 0, nextAttemptAt: now,
    leaseToken: null, createdAt: now, updatedAt: now, lastError: null,
  };
}

export function terminalCleanupRef(firestore: Firestore, jobId: string, version: string): DocumentReference {
  return firestore.collection(VIDEO_TERMINAL_TEMP_CLEANUP_COLLECTION)
    .doc(terminalCleanupQueueId(jobId, version));
}

/**
 * Must be called inside the same transaction that overwrites the FAILED job.
 * Legacy queue records are upgraded only from this still-current old version.
 */
export async function preserveTerminalCleanupBeforeRetry(
  firestore: Firestore, transaction: Transaction,
  jobId: string, oldJob: VideoProcessingJob, now: number
): Promise<boolean> {
  const prepared = buildTerminalCleanupQueue(jobId, oldJob, now);
  if (!prepared) return false;
  const ref = terminalCleanupRef(firestore, jobId, prepared.processingVersion);
  const existing = await transaction.get(ref);
  if (!existing.exists) {
    transaction.create(ref, prepared);
  } else if (!(existing.data() as TerminalCleanupQueue).snapshot) {
    transaction.update(ref, { snapshot: prepared.snapshot });
  }
  return true;
}

function snapshotMatchesQueue(queue: TerminalCleanupQueue, snapshot: TerminalTempCleanupJob): boolean {
  return !!snapshot &&
    buildVideoProcessingJobId(snapshot.ownerUid, snapshot.videoId) === queue.jobId &&
    snapshot.processingVersion === queue.processingVersion &&
    hasTerminalTemporaryAssets(snapshot) &&
    isConfirmedTerminalVideoJob(snapshot);
}

export interface TerminalCleanupClaim {
  readonly snapshot: TerminalTempCleanupJob;
  readonly token: string;
  readonly queue: TerminalCleanupQueue;
}

export async function claimDueTerminalTemporaryCleanup(
  firestore: Firestore, queueRef: DocumentReference, now: number
): Promise<TerminalCleanupClaim | null> {
  return firestore.runTransaction(async transaction => {
    const entry = await transaction.get(queueRef);
    if (!entry.exists) return null;
    const queue = entry.data() as TerminalCleanupQueue;
    if (queue.state !== 'retryable' ||
        typeof queue.nextAttemptAt !== 'number' ||
        !Number.isFinite(queue.nextAttemptAt) || queue.nextAttemptAt > now) return null;

    let snapshot = queue.snapshot;
    if (!snapshot) {
      // Pre-upgrade queue: recover only while its exact terminal job still exists.
      const jobDoc = await transaction.get(
        firestore.collection(VIDEO_PROCESSING_JOBS_COLLECTION).doc(queue.jobId)
      );
      const current = jobDoc.exists ? jobDoc.data() as VideoProcessingJob : null;
      const rebuilt = current && buildTerminalCleanupQueue(queue.jobId, current, now);
      if (rebuilt?.processingVersion === queue.processingVersion) {
        snapshot = rebuilt.snapshot;
        transaction.update(queueRef, { snapshot });
      }
    }
    if (!snapshot || !snapshotMatchesQueue(queue, snapshot)) {
      transaction.update(queueRef, {
        state: 'review', nextAttemptAt: null, leaseToken: null,
        updatedAt: now, lastError: 'VIDEO_TEMP_CLEANUP_SNAPSHOT_UNAVAILABLE',
      });
      return null;
    }
    const token = randomUUID();
    transaction.update(queueRef, {
      leaseToken: token, nextAttemptAt: now + TERMINAL_TEMP_CLEANUP_LEASE_MS,
      updatedAt: now,
    });
    return { snapshot, token, queue };
  });
}

export async function isTerminalTemporaryClaimCurrent(
  queueRef: DocumentReference, claim: TerminalCleanupClaim, now: number
): Promise<boolean> {
  const document = await queueRef.get();
  const current = document.exists ? document.data() as TerminalCleanupQueue : null;
  return !!current && current.state === 'retryable' &&
    current.leaseToken === claim.token &&
    typeof current.nextAttemptAt === 'number' &&
    current.nextAttemptAt > now &&
    !!current.snapshot &&
    JSON.stringify(current.snapshot) === JSON.stringify(claim.snapshot);
}

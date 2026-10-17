/**
 * Transactional, generation-fenced preflight for a version-specific GCS copy.
 * Not yet wired into the submission scheduler: rotation, final provider input
 * and generation-pinned cleanup must be integrated before enabling runtime.
 */
import { randomUUID } from 'node:crypto';
import type { DocumentData, DocumentReference, Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { db } from '../../firebaseApp';
import type { VideoProcessingJob } from './video-processing-job';
import { videoSourceProbeCaptureEnabled } from './video-source-probe.service';
import { extractOwnedPrivateVideoPathForId } from './video-storage-path';
import {
  ImmutableInputPreparationError,
  matchesPersistedImmutableInput,
  type ImmutableTranscoderInput,
} from './video-immutable-input.policy';
import { prepareImmutableTranscoderInput } from './video-immutable-input.storage';
import { matchesVideoSourceProbeSnapshot } from './video-source-probe.policy';

const RESERVATION_MS = 10 * 60_000;
const GENERATION = /^[1-9][0-9]{0,29}$/;

type Job = VideoProcessingJob & {
  immutableInput?: ImmutableTranscoderInput | null;
  immutableInputClaimId?: string | null;
  immutableInputAttempts?: number;
};

type Claim = {
  job: Job;
  token: string;
  reservedUntil: number;
  attempts: number;
};

/**
 * Feature-gated production scheduler entrypoint. A pinned GCS copy is
 * required for generation-aware jobs before SUBMITTING can be claimed.
 * Kept OFF until provider input + rotation + lifecycle cleanup are fenced.
 */
export async function prepareImmutableInputBeforeSubmission(
  jobRef: DocumentReference, now: number
): Promise<boolean> {
  if (!videoSourceProbeCaptureEnabled()) return true;
  return prepareImmutableInputPreflightWithPorts(
    jobRef, now, db, prepareImmutableTranscoderInput
  );
}

export { matchesPersistedImmutableInput } from './video-immutable-input.policy';

function privateVideoMatches(job: Job, video: DocumentData | undefined): boolean {
  if (!video) return false;
  const path = extractOwnedPrivateVideoPathForId(job.ownerUid, job.videoId,
    video['path']) ?? extractOwnedPrivateVideoPathForId(job.ownerUid, job.videoId,
    video['url']);
  return path === job.sourceStoragePath &&
    video['sourceGeneration'] === job.sourceGeneration;
}

function stillClaimed(data: DocumentData | undefined, claim: Claim): boolean {
  return data?.['state'] === 'QUEUED' &&
    data['processingVersion'] === claim.job.processingVersion &&
    data['sourceStoragePath'] === claim.job.sourceStoragePath &&
    data['sourceGeneration'] === claim.job.sourceGeneration &&
    data['immutableInputClaimId'] === claim.token &&
    data['nextAttemptAt'] === claim.reservedUntil;
}

function retryAt(now: number, attempts: number): number {
  const backoff = Math.min(60 * 60_000,
    60_000 * 2 ** Math.min(6, Math.max(0, attempts - 1)));
  return now + backoff;
}

/** Injectable ports for real Firestore Emulator transactions and mocked GCS. */
export async function prepareImmutableInputPreflightWithPorts(
  jobRef: DocumentReference,
  now: number,
  firestore: Firestore,
  copyInput: typeof prepareImmutableTranscoderInput
): Promise<boolean> {
  const decision = await firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) return { kind: 'deferred' as const };
    const job = snapshot.data() as Job;
    if (job.state !== 'QUEUED' || !Number.isSafeInteger(job.nextAttemptAt) ||
        job.nextAttemptAt > now) return { kind: 'deferred' as const };
    // Legacy jobs without a generation cannot use this opt-in path. The caller
    // preserves the existing legacy behavior outside this preflight.
    if (!GENERATION.test(String(job.sourceGeneration ?? ''))) {
      return { kind: 'legacy' as const };
    }
    if (!matchesVideoSourceProbeSnapshot(job, job.sourceProbe)) {
      return { kind: 'deferred' as const };
    }
    const videoRef = firestore.doc(`users/${job.ownerUid}/videos/${job.videoId}`);
    const video = await transaction.get(videoRef);
    if (!privateVideoMatches(job, video.data())) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED', cancelRequestedAt: now,
        nextAttemptAt: now, leaseUntil: null,
        immutableInputClaimId: null, updatedAt: now,
        lastErrorCode: 'SOURCE_CHANGED',
        lastError: 'O arquivo privado associado ao vídeo foi alterado.',
      });
      return { kind: 'deferred' as const };
    }
    if (matchesPersistedImmutableInput(job, job.immutableInput)) {
      return { kind: 'ready' as const };
    }
    const token = randomUUID();
    const reservedUntil = now + RESERVATION_MS;
    const attempts = Math.min(1000,
      Math.max(0, Math.trunc(Number(job.immutableInputAttempts ?? 0) || 0)) + 1);
    transaction.update(jobRef, {
      immutableInputClaimId: token,
      immutableInputAttempts: attempts,
      nextAttemptAt: reservedUntil,
      updatedAt: now,
    });
    transaction.set(videoRef, {
      status: 'queued', processingStage: 'preparing',
      processingErrorCode: null, processingErrorMessage: null,
      updatedAt: now,
    }, { merge: true });
    return { kind: 'claimed' as const,
      claim: { job, token, reservedUntil, attempts } };
  });

  if (decision.kind === 'ready' || decision.kind === 'legacy') return true;
  if (decision.kind !== 'claimed') return false;
  const claim = decision.claim;
  const videoRef = firestore.doc(`users/${claim.job.ownerUid}/videos/${claim.job.videoId}`);

  try {
    const prepared = await copyInput(claim.job);
    if (!matchesPersistedImmutableInput(claim.job, prepared)) {
      throw new ImmutableInputPreparationError('IMMUTABLE_INPUT_RESULT_INVALID', false);
    }
    const finishedAt = Date.now();
    return await firestore.runTransaction(async transaction => {
      const [jobSnapshot, videoSnapshot] = await Promise.all([
        transaction.get(jobRef), transaction.get(videoRef),
      ]);
      if (!stillClaimed(jobSnapshot.data(), claim)) return false;
      if (!privateVideoMatches(claim.job, videoSnapshot.data())) {
        transaction.update(jobRef, {
          state: 'CANCEL_REQUESTED', cancelRequestedAt: finishedAt,
          nextAttemptAt: finishedAt, leaseUntil: null,
          immutableInputClaimId: null, updatedAt: finishedAt,
          lastErrorCode: 'SOURCE_CHANGED',
        });
        return false;
      }
      transaction.update(jobRef, {
        immutableInput: prepared,
        immutableInputClaimId: null,
        nextAttemptAt: finishedAt, updatedAt: finishedAt,
        lastErrorCode: null, lastError: null,
      });
      transaction.set(videoRef, {
        status: 'queued', processingStage: 'queued',
        processingErrorCode: null, processingErrorMessage: null,
        updatedAt: finishedAt,
      }, { merge: true });
      return true;
    });
  } catch (error) {
    const known = error instanceof ImmutableInputPreparationError ? error : null;
    const retryable = known?.retryable ?? true;
    const code = known?.code ?? 'IMMUTABLE_INPUT_TEMPORARY_UNAVAILABLE';
    const failedAt = Date.now();
    await firestore.runTransaction(async transaction => {
      const [jobSnapshot, videoSnapshot] = await Promise.all([
        transaction.get(jobRef), transaction.get(videoRef),
      ]);
      if (!stillClaimed(jobSnapshot.data(), claim)) return;
      const changed = !privateVideoMatches(claim.job, videoSnapshot.data());
      const canRetry = retryable && !changed;
      const status = changed ? 'CANCEL_REQUESTED' : canRetry ? 'QUEUED' : 'FAILED';
      const message = canRetry
        ? 'Preparação técnica temporariamente indisponível.'
        : 'O arquivo original não pôde ser preparado para processamento.';
      transaction.update(jobRef, {
        state: status,
        ...(changed ? { cancelRequestedAt: failedAt } : {}),
        ...(!changed && !canRetry ? { completedAt: failedAt } : {}),
        immutableInputClaimId: null,
        nextAttemptAt: canRetry ? retryAt(failedAt, claim.attempts) : failedAt,
        leaseUntil: null, updatedAt: failedAt,
        lastErrorCode: changed ? 'SOURCE_CHANGED' : code,
        lastError: message,
      });
      if (!changed && videoSnapshot.exists) {
        transaction.set(videoRef, {
          status: canRetry ? 'queued' : 'failed',
          processingStage: canRetry ? 'preparing' : 'failed',
          processingErrorCode: canRetry ? null : code,
          processingErrorMessage: canRetry ? null : message,
          updatedAt: failedAt,
        }, { merge: true });
      }
    });
    logger.warn('[videoImmutableInput] Preparação não concluída.', {
      errorCode: code, retryable,
    });
    return false;
  }
}

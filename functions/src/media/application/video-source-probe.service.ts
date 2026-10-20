import { randomUUID } from 'node:crypto';
import type { DocumentData, DocumentReference, Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { db } from '../../firebaseApp';
import type { VideoProcessingJob } from './video-processing-job';
import { withAdminTriageProjection } from './admin-video-triage.firestore';
import { stageVideoTriageMutationInTransaction }
  from './admin-video-triage-mutation-outbox.firestore';
import { extractOwnedPrivateVideoPathForId } from './video-storage-path';
import { probeVideoSource } from './video-rotation-worker.service';
import {
  classifyVideoSourceProbeFailure,
  createVideoSourceProbeSnapshot,
  matchesVideoSourceProbeSnapshot,
  nextVideoSourceProbeRetryAt,
} from './video-source-probe.policy';

// Prepared code is inert until explicitly enabled in Functions configuration.
export function videoSourceProbeCaptureEnabled(): boolean {
  return process.env.VIDEO_SOURCE_PROBE_CAPTURE_ENABLED === 'true';
}

const PROBE_RESERVATION_MS = 3 * 60_000;

type JobData = VideoProcessingJob & {
  sourceProbeClaimId?: string | null;
  sourceProbeAttempts?: number;
};

type ProbeClaim = {
  job: JobData;
  token: string;
  reservedUntil: number;
  attempts: number;
};

function privateVideoMatches(
  job: JobData,
  rawVideo: DocumentData | undefined
): boolean {
  if (!rawVideo) return false;
  const sourcePath =
    extractOwnedPrivateVideoPathForId(job.ownerUid, job.videoId, rawVideo['path']) ??
    extractOwnedPrivateVideoPathForId(job.ownerUid, job.videoId, rawVideo['url']);
  return sourcePath === job.sourceStoragePath &&
    rawVideo['sourceGeneration'] === job.sourceGeneration;
}

function currentClaim(
  raw: DocumentData | undefined,
  claim: ProbeClaim
): boolean {
  return raw?.['state'] === 'QUEUED' &&
    raw['processingVersion'] === claim.job.processingVersion &&
    raw['sourceStoragePath'] === claim.job.sourceStoragePath &&
    raw['sourceGeneration'] === claim.job.sourceGeneration &&
    raw['sourceProbeClaimId'] === claim.token &&
    raw['nextAttemptAt'] === claim.reservedUntil;
}

/**
 * Capture a version-fenced, immutable-metadata snapshot before SUBMITTING.
 * No provider POST occurs in this function. Concurrent scheduler invocations
 * claim the same job at most once per reservation and stale results are ignored.
 */
export async function prepareVideoSourceProbeBeforeSubmission(
  jobRef: DocumentReference,
  now: number
): Promise<boolean> {
  if (!videoSourceProbeCaptureEnabled()) return true;
  return prepareVideoSourceProbeWithPorts(jobRef, now, db, probeVideoSource);
}

/** Explicit ports permit exercising the production transaction in a disposable emulator. */
export async function prepareVideoSourceProbeWithPorts(
  jobRef: DocumentReference,
  now: number,
  firestore: Firestore,
  inspectSource: typeof probeVideoSource
): Promise<boolean> {
  const initialMutationEventId = randomUUID();
  const completionMutationEventId = randomUUID();
  const failureMutationEventId = randomUUID();
  const decision = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) return { kind: 'deferred' as const };
    const job = snapshot.data() as JobData;
    if (job.state !== 'QUEUED' || job.nextAttemptAt > now) {
      return { kind: 'deferred' as const };
    }

    // Legacy jobs are compatible and remain on their original processing path.
    if (!/^[1-9][0-9]{0,29}$/.test(String(job.sourceGeneration ?? ''))) {
      return { kind: 'ready' as const };
    }
    if (matchesVideoSourceProbeSnapshot(job, job.sourceProbe)) {
      return { kind: 'ready' as const };
    }

    const videoRef = firestore.doc(`users/${job.ownerUid}/videos/${job.videoId}`);
    const videoSnapshot = await transaction.get(videoRef);
    if (!privateVideoMatches(job, videoSnapshot.data())) {
      stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
        eventId: initialMutationEventId, source: 'SOURCE_PROBE',
        kind: 'CANCEL_REQUESTED', before: snapshot,
        afterState: 'CANCEL_REQUESTED',
      });
      transaction.update(jobRef, withAdminTriageProjection(jobRef.id, job, {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: now,
        nextAttemptAt: now,
        leaseUntil: null,
        sourceProbeClaimId: null,
        updatedAt: now,
        lastErrorCode: 'SOURCE_CHANGED',
        lastError: 'A origem privada foi substituída ou removida.',
      }, now));
      return { kind: 'deferred' as const };
    }

    const token = randomUUID();
    const reservedUntil = now + PROBE_RESERVATION_MS;
    const attempts = Math.min(1000,
      Math.max(0, Math.trunc(Number(job.sourceProbeAttempts ?? 0) || 0)) + 1);
    transaction.update(jobRef, withAdminTriageProjection(jobRef.id, job, {
      sourceProbeClaimId: token,
      sourceProbeAttempts: attempts,
      nextAttemptAt: reservedUntil,
      updatedAt: now,
    }, now));
    transaction.set(videoRef, {
      status: 'queued',
      processingStage: 'verifying',
      processingErrorCode: null,
      processingErrorMessage: null,
      updatedAt: now,
    }, { merge: true });
    return {
      kind: 'claimed' as const,
      claim: { job, token, reservedUntil, attempts },
    };
  });

  if (decision.kind === 'ready') return true;
  if (decision.kind !== 'claimed') return false;
  const claim = decision.claim;
  const videoRef = firestore.doc(`users/${claim.job.ownerUid}/videos/${claim.job.videoId}`);

  try {
    const result = await inspectSource(claim.job);
    const checkedAt = Date.now();
    const probeSnapshot = createVideoSourceProbeSnapshot(
      claim.job, result, checkedAt);
    return await firestore.runTransaction(async (transaction) => {
      const [snapshot, videoSnapshot] = await Promise.all([
        transaction.get(jobRef), transaction.get(videoRef),
      ]);
      if (!currentClaim(snapshot.data(), claim)) return false;
      if (!privateVideoMatches(claim.job, videoSnapshot.data())) {
        stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
          eventId: completionMutationEventId, source: 'SOURCE_PROBE',
          kind: 'CANCEL_REQUESTED', before: snapshot,
          afterState: 'CANCEL_REQUESTED',
        });
        transaction.update(jobRef, withAdminTriageProjection(jobRef.id, snapshot.data() as JobData, {
          state: 'CANCEL_REQUESTED',
          cancelRequestedAt: checkedAt,
          nextAttemptAt: checkedAt,
          sourceProbeClaimId: null,
          leaseUntil: null,
          updatedAt: checkedAt,
          lastErrorCode: 'SOURCE_CHANGED',
        }, checkedAt));
        return false;
      }
      transaction.update(jobRef, withAdminTriageProjection(jobRef.id, snapshot.data() as JobData, {
        sourceProbe: probeSnapshot,
        sourceProbeClaimId: null,
        nextAttemptAt: checkedAt,
        updatedAt: checkedAt,
        lastErrorCode: null,
        lastError: null,
      }, checkedAt));
      transaction.set(videoRef, {
        status: 'queued',
        processingStage: 'queued',
        processingErrorCode: null,
        processingErrorMessage: null,
        updatedAt: checkedAt,
      }, { merge: true });
      return true;
    });
  } catch (error) {
    const failure = classifyVideoSourceProbeFailure(error);
    const failedAt = Date.now();
    await firestore.runTransaction(async (transaction) => {
      const [snapshot, videoSnapshot] = await Promise.all([
        transaction.get(jobRef), transaction.get(videoRef),
      ]);
      if (!currentClaim(snapshot.data(), claim)) return;
      const sourceChanged = !privateVideoMatches(claim.job, videoSnapshot.data());
      const retryable = failure.retryable && !sourceChanged;
      const code = sourceChanged ? 'SOURCE_CHANGED' : failure.code;
      const message = retryable
        ? 'Verificação técnica temporariamente indisponível.'
        : 'O arquivo original não pôde ser validado.';
      if (!retryable) {
        stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {
          eventId: failureMutationEventId, source: 'SOURCE_PROBE',
          kind: sourceChanged ? 'CANCEL_REQUESTED' : 'STATE_TRANSITION',
          before: snapshot, afterState: sourceChanged ?
            'CANCEL_REQUESTED' : 'FAILED',
        });
      }
      transaction.update(jobRef, withAdminTriageProjection(jobRef.id, snapshot.data() as JobData, {
        state: sourceChanged ? 'CANCEL_REQUESTED'
          : retryable ? 'QUEUED' : 'FAILED',
        ...(sourceChanged ? { cancelRequestedAt: failedAt } : {}),
        ...(retryable ? {} : { completedAt: failedAt }),
        nextAttemptAt: retryable
          ? nextVideoSourceProbeRetryAt(failedAt, claim.attempts) : failedAt,
        sourceProbeClaimId: null,
        leaseUntil: null,
        updatedAt: failedAt,
        lastErrorCode: code,
        lastError: message,
      }, failedAt));
      if (!sourceChanged && videoSnapshot.exists) {
        transaction.set(videoRef, retryable
          ? {
            status: 'queued',
            processingStage: 'verifying',
            processingErrorCode: null,
            processingErrorMessage: null,
            updatedAt: failedAt,
          }
          : {
            status: 'failed',
            processingStage: 'failed',
            processingErrorCode: code,
            processingErrorMessage: message,
            updatedAt: failedAt,
          }, { merge: true });
      }
    });
    logger.warn('[videoSourceProbe] Inspeção não concluída.', {
      errorCode: failure.code,
      retryable: failure.retryable,
    });
    return false;
  }
}

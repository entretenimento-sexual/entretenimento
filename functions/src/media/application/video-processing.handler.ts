import { randomUUID } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  deleteGoogleVideoTranscoderJob,
  findGoogleVideoTranscoderJob,
  getGoogleVideoTranscoderJob,
  normalizeGoogleTranscoderError,
  submitGoogleVideoTranscoderJob,
} from './google-video-transcoder.service';
import {
  VIDEO_PROCESSING_JOBS_COLLECTION,
  VIDEO_PROCESSING_MAX_ATTEMPTS,
  type VideoProcessingJob,
} from './video-processing-job';
import { extractOwnedPrivateVideoPathForId } from './video-storage-path';
import {
  executeVideoCancellation,
  type VideoCancellationResult,
} from './video-cancellation-execution';
import {
  cancellationCycleNeedsAttention,
  summarizeCancellationCycle,
} from './video-cancellation-observability.policy';
import {
  decideMissingVideoSubmission,
  canAttachSubmittedProviderJob,
} from './video-submission-confirmation.policy';
import {
  providerObservationChanged,
  isCurrentVideoProcessingAttempt,
} from './video-processing-poll.policy';
import {
  claimProcessingJob,
  queryDueProcessingJobs,
  claimDueCancellation,
  queryDueCancelledJobs,
  deleteCancelledJobIfCurrent,
  recordCancellationErrorIfCurrent,
  bindCancelledProviderJobIfCurrent,
  claimExpiredSubmissionLease,
  updateRecoveredSubmissionIfCurrent,
} from './video-processing-reconciliation.firestore';
import { prepareVideoSourceProbeBeforeSubmission, videoSourceProbeCaptureEnabled } from './video-source-probe.service';
import { matchesVideoSourceProbeSnapshot } from './video-source-probe.policy';
import {
  matchesPersistedImmutableInput,
  prepareImmutableInputBeforeSubmission,
} from './video-immutable-input-preflight.service';

interface ProcessedVideoCandidate {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

interface PrivateVideoDocument {
  sourceGeneration?: string | null;
  path?: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
}

const SUBMISSION_BATCH_SIZE = 8;
const RECONCILIATION_BATCH_SIZE = 20;
const CANCELLATION_BATCH_SIZE = 20;
const SUBMISSION_LEASE_MS = 10 * 60 * 1000;
const AMBIGUOUS_SUBMISSION_LEASE_MS = 5 * 60 * 1000;
const SCHEDULE_TIME_ZONE = 'America/Sao_Paulo';

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    containsControlCharacter(normalized)
  ) {
    return '';
  }

  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOutputPrefix(
  ownerUid: string,
  videoId: string,
  value: unknown
): string | null {
  const normalized = String(value ?? '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const expected = new RegExp(
    `^users/${escapeRegExp(ownerUid)}/processed/videos/` +
      `${escapeRegExp(videoId)}/[^/]+$`
  );

  return expected.test(normalized) ? `${normalized}/` : null;
}

function normalizeState(value: unknown): VideoProcessingJob['state'] {
  const state = String(value ?? '').trim().toUpperCase();

  if (
    state === 'QUEUED' ||
    state === 'SUBMITTING' ||
    state === 'PROCESSING' ||
    state === 'SUCCEEDED' ||
    state === 'FAILED' ||
    state === 'CANCEL_REQUESTED' ||
    state === 'CANCELLED'
  ) {
    return state;
  }

  return 'FAILED';
}

function normalizePositiveInteger(value: unknown): number | null {
  const numberValue = Number(value ?? 0);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : null;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numberValue = Number(value ?? 0);

  return Number.isFinite(numberValue) && numberValue >= 0
    ? Math.trunc(numberValue)
    : 0;
}

function normalizeOptionalNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0
    ? Math.trunc(numberValue)
    : null;
}

function normalizeJob(data: unknown): VideoProcessingJob | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const job = data as Partial<VideoProcessingJob>;
  const ownerUid = cleanId(job.ownerUid);
  const videoId = cleanId(job.videoId);
  const sourceStoragePath = extractOwnedPrivateVideoPathForId(
    ownerUid,
    videoId,
    job.sourceStoragePath
  );
  const outputPrefix = normalizeOutputPrefix(
    ownerUid,
    videoId,
    job.outputPrefix
  );
  const processingVersion = cleanId(job.processingVersion);

  if (
    !ownerUid ||
    !videoId ||
    !sourceStoragePath ||
    !outputPrefix ||
    !processingVersion
  ) {
    return null;
  }

  return {
    ownerUid,
    videoId,
    sourceStoragePath,
    ...(typeof job.sourceGeneration === 'string' &&
        /^[1-9][0-9]{0,29}$/.test(job.sourceGeneration)
      ? { sourceGeneration: job.sourceGeneration } : {}),
    sourceProbe: job.sourceProbe ?? null,
    immutableInput: job.immutableInput ?? null,
    sourcePosterStoragePath:
      String(job.sourcePosterStoragePath ?? '').trim() || null,
    sourceMimeType: String(job.sourceMimeType ?? '').trim().toLowerCase(),
    sourceSizeBytes: normalizePositiveInteger(job.sourceSizeBytes) ?? 0,
    sourceDurationMs: normalizePositiveInteger(job.sourceDurationMs),
    outputPrefix,
    processingVersion,
    provider: 'GOOGLE_TRANSCODER',
    state: normalizeState(job.state),
    attempts: normalizeNonNegativeInteger(job.attempts),
    submissionLookupMisses: normalizeNonNegativeInteger(job.submissionLookupMisses),
    cancellationCleanupAttempts: normalizeNonNegativeInteger(
      job.cancellationCleanupAttempts
    ),
    cancellationReviewRequired: job.cancellationReviewRequired === true,
    nextAttemptAt: normalizeNonNegativeInteger(job.nextAttemptAt),
    leaseUntil: normalizeOptionalNonNegativeInteger(job.leaseUntil),
    externalJobName: String(job.externalJobName ?? '').trim() || null,
    providerState: String(job.providerState ?? '').trim() || null,
    outputStoragePath: String(job.outputStoragePath ?? '').trim() || null,
    outputMimeType: String(job.outputMimeType ?? '').trim() || null,
    outputSizeBytes: normalizeOptionalNonNegativeInteger(job.outputSizeBytes),
    submittedAt: normalizeOptionalNonNegativeInteger(job.submittedAt),
    completedAt: normalizeOptionalNonNegativeInteger(job.completedAt),
    cancelRequestedAt: normalizeOptionalNonNegativeInteger(
      job.cancelRequestedAt
    ),
    createdAt: normalizeNonNegativeInteger(job.createdAt),
    updatedAt: normalizeNonNegativeInteger(job.updatedAt),
    lastErrorCode: String(job.lastErrorCode ?? '').trim() || null,
    lastError: String(job.lastError ?? '').trim() || null,
  };
}

function privateSourcePath(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDocument
): string | null {
  return (
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url)
  );
}

async function claimQueuedJob(
  jobRef: DocumentReference,
  now: number
): Promise<VideoProcessingJob | null> {
  return db.runTransaction(async (transaction) => {
    const jobSnapshot = await transaction.get(jobRef);
    const job = jobSnapshot.exists
      ? normalizeJob(jobSnapshot.data())
      : null;

    if (
      !job ||
      job.state !== 'QUEUED' ||
      job.nextAttemptAt > now ||
      (videoSourceProbeCaptureEnabled() && !!job.sourceGeneration &&
        !matchesVideoSourceProbeSnapshot(job, job.sourceProbe)) ||
      (videoSourceProbeCaptureEnabled() && !!job.sourceGeneration &&
        !matchesPersistedImmutableInput(job, job.immutableInput))
    ) {
      return null;
    }

    const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);
    const videoSnapshot = await transaction.get(videoRef);

    if (!videoSnapshot.exists) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: now,
        nextAttemptAt: now,
        leaseUntil: null,
        updatedAt: now,
        lastErrorCode: 'PRIVATE_VIDEO_DELETED',
        lastError: 'O vídeo privado foi excluído.',
      });
      return null;
    }

    const video = videoSnapshot.data() as PrivateVideoDocument;

    if (
      privateSourcePath(job.ownerUid, job.videoId, video) !==
      job.sourceStoragePath ||
      (!!job.sourceGeneration && video.sourceGeneration !== job.sourceGeneration)
    ) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: now,
        nextAttemptAt: now,
        leaseUntil: null,
        updatedAt: now,
        lastErrorCode: 'SOURCE_CHANGED',
        lastError: 'O arquivo privado associado ao vídeo foi alterado.',
      });
      return null;
    }

    if (job.attempts >= VIDEO_PROCESSING_MAX_ATTEMPTS) {
      transaction.update(jobRef, {
        state: 'FAILED',
        leaseUntil: null,
        completedAt: now,
        updatedAt: now,
        lastErrorCode: 'MAX_ATTEMPTS_EXCEEDED',
        lastError: 'O limite de tentativas de processamento foi atingido.',
      });
      transaction.set(
        videoRef,
        {
          status: 'failed',
          processingStage: 'failed',
          processingErrorCode: 'MAX_ATTEMPTS_EXCEEDED',
          processingErrorMessage:
            'O vídeo não pôde ser processado após várias tentativas.',
          updatedAt: now,
        },
        { merge: true }
      );
      return null;
    }

    const claimed: VideoProcessingJob = {
      ...job,
      state: 'SUBMITTING',
      attempts: job.attempts + 1,
      submissionLookupMisses: 0,
      leaseUntil: now + SUBMISSION_LEASE_MS,
      updatedAt: now,
      lastErrorCode: null,
      lastError: null,
    };

    transaction.update(jobRef, {
      state: claimed.state,
      attempts: claimed.attempts,
      submissionLookupMisses: 0,
      leaseUntil: claimed.leaseUntil,
      updatedAt: now,
      lastErrorCode: null,
      lastError: null,
    });
    transaction.set(
      videoRef,
      {
        status: 'processing',
        processingStage: 'submitting',
        processingErrorCode: null,
        processingErrorMessage: null,
        updatedAt: now,
      },
      { merge: true }
    );

    return claimed;
  });
}

async function persistSubmittedJob(
  jobRef: DocumentReference,
  job: VideoProcessingJob,
  externalJobName: string,
  providerState: string
): Promise<void> {
  const now = Date.now();

  await db.runTransaction(async (transaction) => {
    const [jobSnapshot, videoSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(db.doc(`users/${job.ownerUid}/videos/${job.videoId}`)),
    ]);
    const currentJob = jobSnapshot.exists
      ? normalizeJob(jobSnapshot.data())
      : null;

    if (!currentJob || !canAttachSubmittedProviderJob(
      currentJob, job, externalJobName
    )) {
      return;
    }

    if (
      currentJob.state === 'CANCEL_REQUESTED' ||
      !videoSnapshot.exists
    ) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        externalJobName,
        providerState,
        cancelRequestedAt: currentJob.cancelRequestedAt ?? now,
        nextAttemptAt: currentJob.state === 'CANCEL_REQUESTED'
          ? currentJob.nextAttemptAt
          : now,
        leaseUntil: null,
        updatedAt: now,
      });
      return;
    }

    const video = videoSnapshot.data() as PrivateVideoDocument;

    if (
      privateSourcePath(job.ownerUid, job.videoId, video) !==
      job.sourceStoragePath ||
      (!!job.sourceGeneration && video.sourceGeneration !== job.sourceGeneration)
    ) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        externalJobName,
        providerState,
        cancelRequestedAt: now,
        nextAttemptAt: now,
        leaseUntil: null,
        updatedAt: now,
        lastErrorCode: 'SOURCE_CHANGED',
        lastError: 'O arquivo privado associado ao vídeo foi alterado.',
      });
      return;
    }

    transaction.update(jobRef, {
      state: 'PROCESSING',
      externalJobName,
      providerState,
      submittedAt: currentJob.submittedAt ?? now,
      nextAttemptAt: now,
      leaseUntil: null,
      updatedAt: now,
      lastErrorCode: null,
      lastError: null,
    });
    transaction.set(
      videoSnapshot.ref,
      {
        status: 'processing',
        processingStage: 'processing',
        processingErrorCode: null,
        processingErrorMessage: null,
        updatedAt: now,
      },
      { merge: true }
    );
  });
}

async function handleSubmissionFailure(
  jobRef: DocumentReference,
  job: VideoProcessingJob,
  error: unknown
): Promise<void> {
  const normalized = normalizeGoogleTranscoderError(error);
  const now = Date.now();
  const retryable = normalized.retryable;

  // A late POST failure cannot resurrect cancellation, overwrite a newer
  // processingVersion, or roll back a successful provider submission.
  const applied = await updateRecoveredSubmissionIfCurrent(
    db, jobRef, job, normalizeJob, {
      now,
      jobPatch: {
        state: retryable ? 'SUBMITTING' : 'FAILED',
        leaseUntil: retryable
          ? now + AMBIGUOUS_SUBMISSION_LEASE_MS
          : null,
        ...(retryable ? {} : { completedAt: now }),
        updatedAt: now,
        lastErrorCode: normalized.code,
        lastError: normalized.message,
      },
      videoPatch: retryable
        ? {
          status: 'processing',
          processingStage: 'confirming_submission',
          processingErrorCode: null,
          processingErrorMessage: null,
          updatedAt: now,
        }
        : {
          status: 'failed',
          processingStage: 'failed',
          processingErrorCode: normalized.code,
          processingErrorMessage:
            'Não foi possível iniciar o processamento deste vídeo.',
          updatedAt: now,
        },
    }
  );

  logger.warn('[videoProcessing] Falha ao enviar job.', {
    ownerUid: job.ownerUid,
    videoId: job.videoId,
    attempts: job.attempts,
    retryable,
    applied,
    errorCode: normalized.code,
    error: normalized.message,
  });
}

async function submitClaimedJob(
  jobRef: DocumentReference,
  job: VideoProcessingJob
): Promise<void> {
  try {
    const providerJob = await submitGoogleVideoTranscoderJob(job);
    await persistSubmittedJob(
      jobRef,
      job,
      providerJob.name,
      providerJob.state
    );
  } catch (error) {
    await handleSubmissionFailure(jobRef, job, error);
  }
}

async function recoverExpiredSubmission(
  jobRef: DocumentReference,
  job: VideoProcessingJob
): Promise<void> {
  try {
    // A provider lookup is mandatory before considering another submission.
    // A null response is handled only by a fenced transaction below.
    const recovered = await findGoogleVideoTranscoderJob(
      job.processingVersion
    );

    if (recovered) {
      await persistSubmittedJob(
        jobRef,
        job,
        recovered.name,
        recovered.state
      );
      return;
    }

    const now = Date.now();
    const decision = decideMissingVideoSubmission(job, now);

    // A negative list response cannot prove the prior POST was rejected.
    // Hold the job for further confirmation; never requeue automatically.
    await updateRecoveredSubmissionIfCurrent(
      db, jobRef, job, normalizeJob, {
        now,
        jobPatch: {
          ...decision,
          updatedAt: now,
        },
        videoPatch: {
          status: 'processing',
          processingStage: 'confirming_submission',
          processingErrorCode: decision.lastErrorCode,
          processingErrorMessage: decision.lastError,
          updatedAt: now,
        },
      }
    );
  } catch (error) {
    const normalized = normalizeGoogleTranscoderError(error);
    const now = Date.now();
    // When recovering PROCESSING without a provider name, preserve its state.
    // A late exception must not regress a cancelled or completed attempt.
    await updateRecoveredSubmissionIfCurrent(
      db, jobRef, job, normalizeJob, {
        now,
        jobPatch: {
          state: job.state,
          ...(job.state === 'SUBMITTING'
            ? { leaseUntil: now + AMBIGUOUS_SUBMISSION_LEASE_MS }
            : {}),
          updatedAt: now,
          lastErrorCode: normalized.code,
          lastError: normalized.message,
        },
      }
    );

    logger.warn('[videoProcessing] Falha ao recuperar submissão.', {
      ownerUid: job.ownerUid,
      videoId: job.videoId,
      errorCode: normalized.code,
      error: normalized.message,
    });
  }
}

async function recoverExpiredSubmissionLeases(): Promise<void> {
  const now = Date.now();
  const snapshot = await db
    .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .where('state', '==', 'SUBMITTING')
    .where('leaseUntil', '<=', now)
    .orderBy('leaseUntil', 'asc')
    .limit(SUBMISSION_BATCH_SIZE)
    .get();

  const tasks: Array<() => Promise<void>> = [];
  for (const jobDoc of snapshot.docs) {
    const claimed = await claimExpiredSubmissionLease(
      db, jobDoc.ref, now, AMBIGUOUS_SUBMISSION_LEASE_MS, normalizeJob
    );
    if (claimed) {
      tasks.push(() => recoverExpiredSubmission(jobDoc.ref, claimed));
    }
  }
  await runBatch(tasks, 'recover-submissions');
}

function inferVideoMimeType(fileName: string, contentType: unknown): string {
  const normalizedType = String(contentType ?? '').trim().toLowerCase();

  if (normalizedType === 'video/mp4' || normalizedType === 'video/webm') {
    return normalizedType;
  }

  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.mp4')) {
    return 'video/mp4';
  }

  if (lowerName.endsWith('.webm')) {
    return 'video/webm';
  }

  return '';
}

async function findProcessedVideoCandidate(
  job: VideoProcessingJob
): Promise<ProcessedVideoCandidate> {
  const [files] = await storage.bucket().getFiles({ prefix: job.outputPrefix });
  const candidates: ProcessedVideoCandidate[] = [];

  for (const file of files) {
    const [metadata] = await file.getMetadata();
    const mimeType = inferVideoMimeType(file.name, metadata.contentType);
    const sizeBytes = normalizePositiveInteger(metadata.size);

    if (sizeBytes && mimeType) {
      candidates.push({
        storagePath: file.name,
        mimeType,
        sizeBytes,
      });
    }
  }

  candidates.sort((left, right) => {
    if (left.mimeType === right.mimeType) {
      return right.sizeBytes - left.sizeBytes;
    }

    return left.mimeType === 'video/mp4' ? -1 : 1;
  });

  const candidate = candidates[0];

  if (!candidate) {
    throw new Error(
      'O Transcoder concluiu sem gerar um derivado reproduzível.'
    );
  }

  return candidate;
}

async function finalizeSucceededJob(
  jobRef: DocumentReference,
  job: VideoProcessingJob
): Promise<void> {
  const candidate = await findProcessedVideoCandidate(job);
  const now = Date.now();

  await db.runTransaction(async (transaction) => {
    const [jobSnapshot, videoSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(db.doc(`users/${job.ownerUid}/videos/${job.videoId}`)),
    ]);
    const currentJob = jobSnapshot.exists
      ? normalizeJob(jobSnapshot.data())
      : null;

    if (!currentJob || !isCurrentVideoProcessingAttempt(currentJob, job)) {
      return;
    }

    if (!videoSnapshot.exists) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: currentJob.cancelRequestedAt ?? now,
        nextAttemptAt: now,
        leaseUntil: null,
        updatedAt: now,
      });
      return;
    }

    const video = videoSnapshot.data() as PrivateVideoDocument;

    if (
      privateSourcePath(job.ownerUid, job.videoId, video) !==
      job.sourceStoragePath ||
      (!!job.sourceGeneration && video.sourceGeneration !== job.sourceGeneration)
    ) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: now,
        nextAttemptAt: now,
        leaseUntil: null,
        updatedAt: now,
        lastErrorCode: 'SOURCE_CHANGED',
        lastError: 'O arquivo privado associado ao vídeo foi alterado.',
      });
      return;
    }

    transaction.update(jobRef, {
      state: 'SUCCEEDED',
      providerState: 'SUCCEEDED',
      outputStoragePath: candidate.storagePath,
      outputMimeType: candidate.mimeType,
      outputSizeBytes: candidate.sizeBytes,
      completedAt: now,
      leaseUntil: null,
      updatedAt: now,
      lastErrorCode: null,
      lastError: null,
    });
    transaction.set(
      videoSnapshot.ref,
      {
        sourceMimeType: video.mimeType ?? job.sourceMimeType,
        sourceSizeBytes: video.sizeBytes ?? job.sourceSizeBytes,
        mimeType: candidate.mimeType,
        sizeBytes: candidate.sizeBytes,
        status: 'ready',
        playbackPath: candidate.storagePath,
        processedStoragePath: candidate.storagePath,
        processedOutputPrefix: job.outputPrefix,
        processedMimeType: candidate.mimeType,
        processedSizeBytes: candidate.sizeBytes,
        processingStage: 'ready',
        processingErrorCode: null,
        processingErrorMessage: null,
        processingCompletedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  });
}

async function markProviderFailure(
  jobRef: DocumentReference,
  job: VideoProcessingJob,
  errorCode: string | null,
  errorMessage: string | null
): Promise<void> {
  const now = Date.now();
  const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);

  await db.runTransaction(async (transaction) => {
    const [jobSnapshot, videoSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(videoRef),
    ]);
    const current = jobSnapshot.exists
      ? normalizeJob(jobSnapshot.data())
      : null;

    if (!current || !isCurrentVideoProcessingAttempt(current, job)) {
      return;
    }

    const video = videoSnapshot.exists
      ? videoSnapshot.data() as PrivateVideoDocument
      : null;
    if (
      !video ||
      privateSourcePath(job.ownerUid, job.videoId, video) !== job.sourceStoragePath
    ) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: now,
        nextAttemptAt: now,
        leaseUntil: null,
        updatedAt: now,
      });
      return;
    }

    const failureCode = errorCode || 'TRANSCODER_JOB_FAILED';
    transaction.update(jobRef, {
      state: 'FAILED',
      providerState: 'FAILED',
      completedAt: now,
      leaseUntil: null,
      updatedAt: now,
      lastErrorCode: failureCode,
      lastError: errorMessage || 'O job de transcodificação falhou.',
    });
    transaction.set(videoRef, {
      status: 'failed',
      processingStage: 'failed',
      processingErrorCode: failureCode,
      processingErrorMessage:
        'Não foi possível preparar uma versão compatível deste vídeo.',
      updatedAt: now,
    }, { merge: true });
  });
}

async function reconcileProcessingJob(
  jobRef: DocumentReference,
  job: VideoProcessingJob
): Promise<void> {
  if (!job.externalJobName) {
    await recoverExpiredSubmission(jobRef, job);
    return;
  }

  try {
    const providerJob = await getGoogleVideoTranscoderJob(job.externalJobName);
    const now = Date.now();

    if (providerJob.state === 'SUCCEEDED') {
      await finalizeSucceededJob(jobRef, job);
      return;
    }

    if (providerJob.state === 'FAILED') {
      await markProviderFailure(
        jobRef,
        job,
        providerJob.errorCode,
        providerJob.errorMessage
      );
      return;
    }

    if (providerObservationChanged(job, providerJob.state)) {
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(jobRef);
        const current = snapshot.exists
          ? normalizeJob(snapshot.data())
          : null;

        if (
          !current ||
          !isCurrentVideoProcessingAttempt(current, job) ||
          !providerObservationChanged(current, providerJob.state)
        ) {
          return;
        }

        transaction.update(jobRef, {
          providerState: providerJob.state,
          updatedAt: now,
          lastErrorCode: null,
          lastError: null,
        });
      });
    }
  } catch (error) {
    const normalized = normalizeGoogleTranscoderError(error);

    if (normalized.retryable) {
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(jobRef);
        const current = snapshot.exists
          ? normalizeJob(snapshot.data())
          : null;

        if (!current || !isCurrentVideoProcessingAttempt(current, job)) {
          return;
        }

        if (
          current.lastErrorCode === normalized.code &&
          current.lastError === normalized.message
        ) {
          return;
        }

        transaction.update(jobRef, {
          updatedAt: Date.now(),
          lastErrorCode: normalized.code,
          lastError: normalized.message,
        });
      });
      return;
    }

    await markProviderFailure(
      jobRef,
      job,
      normalized.code,
      normalized.message
    );
  }
}

async function deleteOutputPrefix(outputPrefix: string): Promise<void> {
  const [files] = await storage.bucket().getFiles({ prefix: outputPrefix });

  await Promise.all(
    files.map((file) => file.delete({ ignoreNotFound: true }))
  );
}

async function processCancellation(
  jobRef: DocumentReference,
  job: VideoProcessingJob
): Promise<VideoCancellationResult> {
  return executeVideoCancellation(job, {
    findProviderJob: findGoogleVideoTranscoderJob,
    bindProviderJob: (started, providerName) =>
      bindCancelledProviderJobIfCurrent(
        db, jobRef, started, providerName, normalizeJob, Date.now()
      ),
    deleteProviderJob: deleteGoogleVideoTranscoderJob,
    deleteOutputPrefix,
    deleteCancelledJob: (started) =>
      deleteCancelledJobIfCurrent(db, jobRef, started, normalizeJob),
    recordFailure: (started, error, now) =>
      recordCancellationErrorIfCurrent(
        db, jobRef, started, normalizeJob, error, now
      ),
    normalizeError: normalizeGoogleTranscoderError,
    now: Date.now,
  });
}

async function runBatch(
  tasks: Array<() => Promise<void>>,
  operation: string
): Promise<void> {
  const results = await Promise.allSettled(tasks.map((task) => task()));

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error('[videoProcessing] Falha isolada no lote.', {
        operation,
        taskIndex: index,
        error: result.reason instanceof Error
          ? result.reason.message
          : String(result.reason ?? ''),
      });
    }
  });
}

export const submitQueuedVideoProcessing = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 5 minutes',
    timeZone: SCHEDULE_TIME_ZONE,
    retryCount: 3,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    await recoverExpiredSubmissionLeases();

    const now = Date.now();
    const snapshot = await db
      .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
      .where('state', '==', 'QUEUED')
      .where('nextAttemptAt', '<=', now)
      .orderBy('nextAttemptAt', 'asc')
      .limit(SUBMISSION_BATCH_SIZE)
      .get();
    const tasks: Array<() => Promise<void>> = [];

    for (const jobDoc of snapshot.docs) {
      tasks.push(async () => {
        if (!await prepareVideoSourceProbeBeforeSubmission(jobDoc.ref, Date.now())) {
          return;
        }
        if (!await prepareImmutableInputBeforeSubmission(jobDoc.ref, Date.now())) {
          return;
        }
        const claimedJob = await claimQueuedJob(jobDoc.ref, Date.now());
        if (claimedJob) await submitClaimedJob(jobDoc.ref, claimedJob);
      });
    }

    await runBatch(tasks, 'submit');
  }
);

export const reconcileVideoProcessing = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 5 minutes',
    timeZone: SCHEDULE_TIME_ZONE,
    retryCount: 3,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const now = Date.now();
    const snapshot = await queryDueProcessingJobs(
      db, now, RECONCILIATION_BATCH_SIZE
    ).get();
    const tasks: Array<() => Promise<void>> = [];

    for (const jobDoc of snapshot.docs) {
      const claimedJob = await claimProcessingJob(db, jobDoc.ref, now, normalizeJob);

      if (claimedJob) {
        tasks.push(() => reconcileProcessingJob(jobDoc.ref, claimedJob));
      }
    }

    await runBatch(tasks, 'reconcile');
  }
);

export const cleanupCancelledVideoProcessing = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 30 minutes',
    timeZone: SCHEDULE_TIME_ZONE,
    retryCount: 3,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const cycleId = randomUUID();
    const startedAt = Date.now();
    let phase: 'QUERY' | 'CLAIM' | 'EXECUTE' = 'QUERY';

    logger.info('[videoProcessing] Ciclo de cancelamentos iniciado.', {
      event: 'VIDEO_CANCELLATION_CYCLE_STARTED',
      cycleId,
      startedAt,
    });

    try {
      const snapshot = await queryDueCancelledJobs(
        db, startedAt, CANCELLATION_BATCH_SIZE
      ).get();
      phase = 'CLAIM';
      const tasks: Array<() => Promise<VideoCancellationResult>> = [];
      let invalidCancellationCount = 0;

      for (const jobDoc of snapshot.docs) {
        const job = normalizeJob(jobDoc.data());

        if (!job) {
          // Preserve malformed tracking, even if the remote job still exists.
          invalidCancellationCount += 1;
          continue;
        }

        const claimed = await claimDueCancellation(
          db, jobDoc.ref, startedAt, normalizeJob
        );
        if (claimed) {
          tasks.push(() => processCancellation(jobDoc.ref, claimed));
        }
      }

      phase = 'EXECUTE';
      const results = await Promise.allSettled(
        tasks.map((task) => task())
      );
      const metrics = summarizeCancellationCycle(
        snapshot.size, tasks.length, invalidCancellationCount,
        CANCELLATION_BATCH_SIZE, results, Date.now() - startedAt
      );
      const needsAttention = cancellationCycleNeedsAttention(metrics);

      const details = {
        event: 'VIDEO_CANCELLATION_CYCLE_FINISHED',
        cycleId,
        status: needsAttention ? 'ATTENTION' : 'OK',
        ...metrics,
      };
      if (needsAttention) {
        logger.warn('[videoProcessing] Ciclo de cancelamentos concluído.', details);
      } else {
        logger.info('[videoProcessing] Ciclo de cancelamentos concluído.', details);
      }
    } catch (error) {
      logger.error('[videoProcessing] Falha no ciclo de cancelamentos.', {
        event: 'VIDEO_CANCELLATION_CYCLE_FAILED',
        cycleId,
        phase,
        durationMs: Date.now() - startedAt,
      });
      // Let the scheduler report and retry the failed invocation.
      throw error;
    }
  }
);

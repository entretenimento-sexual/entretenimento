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

interface ProcessedVideoCandidate {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

interface PrivateVideoDocument {
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
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
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

function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(6, attempts - 1));
  return Math.min(MAX_RETRY_DELAY_MS, 60_000 * 2 ** exponent);
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

async function updatePrivateVideoIfPresent(
  job: VideoProcessingJob,
  patch: Record<string, unknown>
): Promise<void> {
  const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);
  const snapshot = await videoRef.get();

  if (!snapshot.exists) {
    return;
  }

  const video = snapshot.data() as PrivateVideoDocument;

  if (
    privateSourcePath(job.ownerUid, job.videoId, video) !==
    job.sourceStoragePath
  ) {
    return;
  }

  await videoRef.set(patch, { merge: true });
}

async function requestCancellation(
  jobRef: DocumentReference,
  job: VideoProcessingJob,
  reason: string,
  externalJobName?: string | null
): Promise<void> {
  const now = Date.now();

  await jobRef.update({
    state: 'CANCEL_REQUESTED',
    externalJobName: externalJobName ?? job.externalJobName ?? null,
    cancelRequestedAt: job.cancelRequestedAt ?? now,
    leaseUntil: null,
    updatedAt: now,
    lastErrorCode: reason,
    lastError: 'O processamento foi cancelado porque o vídeo deixou de existir.',
  });
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
      job.nextAttemptAt > now
    ) {
      return null;
    }

    const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);
    const videoSnapshot = await transaction.get(videoRef);

    if (!videoSnapshot.exists) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: now,
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
      job.sourceStoragePath
    ) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: now,
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
      leaseUntil: now + SUBMISSION_LEASE_MS,
      updatedAt: now,
      lastErrorCode: null,
      lastError: null,
    };

    transaction.update(jobRef, {
      state: claimed.state,
      attempts: claimed.attempts,
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

    if (!currentJob) {
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
        leaseUntil: null,
        updatedAt: now,
      });
      return;
    }

    const video = videoSnapshot.data() as PrivateVideoDocument;

    if (
      privateSourcePath(job.ownerUid, job.videoId, video) !==
      job.sourceStoragePath
    ) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        externalJobName,
        providerState,
        cancelRequestedAt: now,
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

  if (normalized.retryable) {
    await jobRef.update({
      state: 'SUBMITTING',
      leaseUntil: now + AMBIGUOUS_SUBMISSION_LEASE_MS,
      updatedAt: now,
      lastErrorCode: normalized.code,
      lastError: normalized.message,
    });
    await updatePrivateVideoIfPresent(job, {
      status: 'processing',
      processingStage: 'confirming_submission',
      processingErrorCode: null,
      processingErrorMessage: null,
      updatedAt: now,
    });
  } else {
    await jobRef.update({
      state: 'FAILED',
      leaseUntil: null,
      completedAt: now,
      updatedAt: now,
      lastErrorCode: normalized.code,
      lastError: normalized.message,
    });
    await updatePrivateVideoIfPresent(job, {
      status: 'failed',
      processingStage: 'failed',
      processingErrorCode: normalized.code,
      processingErrorMessage:
        'Não foi possível iniciar o processamento deste vídeo.',
      updatedAt: now,
    });
  }

  logger.warn('[videoProcessing] Falha ao enviar job.', {
    ownerUid: job.ownerUid,
    videoId: job.videoId,
    attempts: job.attempts,
    retryable: normalized.retryable,
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
    const canRetry = job.attempts < VIDEO_PROCESSING_MAX_ATTEMPTS;

    if (canRetry) {
      await jobRef.update({
        state: 'QUEUED',
        nextAttemptAt: now + retryDelayMs(job.attempts),
        leaseUntil: null,
        updatedAt: now,
        lastErrorCode: 'SUBMISSION_NOT_FOUND',
        lastError: 'Nenhum job externo foi localizado para a submissão.',
      });
      await updatePrivateVideoIfPresent(job, {
        status: 'queued',
        processingStage: 'retry_wait',
        processingErrorCode: null,
        processingErrorMessage: null,
        updatedAt: now,
      });
      return;
    }

    await jobRef.update({
      state: 'FAILED',
      leaseUntil: null,
      completedAt: now,
      updatedAt: now,
      lastErrorCode: 'SUBMISSION_NOT_FOUND',
      lastError: 'O job externo não foi localizado após várias tentativas.',
    });
    await updatePrivateVideoIfPresent(job, {
      status: 'failed',
      processingStage: 'failed',
      processingErrorCode: 'SUBMISSION_NOT_FOUND',
      processingErrorMessage:
        'Não foi possível confirmar o envio do vídeo para processamento.',
      updatedAt: now,
    });
  } catch (error) {
    const normalized = normalizeGoogleTranscoderError(error);

    await jobRef.update({
      state: 'SUBMITTING',
      leaseUntil: Date.now() + AMBIGUOUS_SUBMISSION_LEASE_MS,
      updatedAt: Date.now(),
      lastErrorCode: normalized.code,
      lastError: normalized.message,
    });

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
    .limit(SUBMISSION_BATCH_SIZE)
    .get();

  await runBatch(
    snapshot.docs
      .map((jobDoc) => ({ jobDoc, job: normalizeJob(jobDoc.data()) }))
      .filter(({ job }) => !!job && !!job.leaseUntil && job.leaseUntil <= now)
      .map(({ jobDoc, job }) => () =>
        recoverExpiredSubmission(jobDoc.ref, job as VideoProcessingJob)
      ),
    'recover-submissions'
  );
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

    if (!currentJob) {
      return;
    }

    if (
      currentJob.state === 'CANCEL_REQUESTED' ||
      !videoSnapshot.exists
    ) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: currentJob.cancelRequestedAt ?? now,
        leaseUntil: null,
        updatedAt: now,
      });
      return;
    }

    const video = videoSnapshot.data() as PrivateVideoDocument;

    if (
      privateSourcePath(job.ownerUid, job.videoId, video) !==
      job.sourceStoragePath
    ) {
      transaction.update(jobRef, {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: now,
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

  await jobRef.update({
    state: 'FAILED',
    providerState: 'FAILED',
    completedAt: now,
    leaseUntil: null,
    updatedAt: now,
    lastErrorCode: errorCode || 'TRANSCODER_JOB_FAILED',
    lastError: errorMessage || 'O job de transcodificação falhou.',
  });
  await updatePrivateVideoIfPresent(job, {
    status: 'failed',
    processingStage: 'failed',
    processingErrorCode: errorCode || 'TRANSCODER_JOB_FAILED',
    processingErrorMessage:
      'Não foi possível preparar uma versão compatível deste vídeo.',
    updatedAt: now,
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

    await jobRef.update({
      providerState: providerJob.state,
      updatedAt: now,
      lastErrorCode: null,
      lastError: null,
    });
  } catch (error) {
    const normalized = normalizeGoogleTranscoderError(error);

    if (normalized.retryable) {
      await jobRef.update({
        updatedAt: Date.now(),
        lastErrorCode: normalized.code,
        lastError: normalized.message,
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
): Promise<void> {
  try {
    if (job.externalJobName) {
      await deleteGoogleVideoTranscoderJob(job.externalJobName);
    }

    await deleteOutputPrefix(job.outputPrefix);
    await jobRef.delete();
  } catch (error) {
    const normalized = normalizeGoogleTranscoderError(error);

    await jobRef.set(
      {
        state: 'CANCEL_REQUESTED',
        updatedAt: Date.now(),
        lastErrorCode: normalized.code,
        lastError: normalized.message,
      },
      { merge: true }
    );

    logger.warn('[videoProcessing] Cancelamento pendente.', {
      ownerUid: job.ownerUid,
      videoId: job.videoId,
      errorCode: normalized.code,
      error: normalized.message,
    });
  }
}

async function removeInvalidJob(jobRef: DocumentReference): Promise<void> {
  logger.error('[videoProcessing] Job inválido removido.', {
    jobId: jobRef.id,
  });
  await jobRef.delete().catch(() => undefined);
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
      .limit(SUBMISSION_BATCH_SIZE)
      .get();
    const tasks: Array<() => Promise<void>> = [];

    for (const jobDoc of snapshot.docs) {
      const claimedJob = await claimQueuedJob(jobDoc.ref, now);

      if (claimedJob) {
        tasks.push(() => submitClaimedJob(jobDoc.ref, claimedJob));
      }
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
    const snapshot = await db
      .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
      .where('state', '==', 'PROCESSING')
      .limit(RECONCILIATION_BATCH_SIZE)
      .get();
    const tasks: Array<() => Promise<void>> = [];

    for (const jobDoc of snapshot.docs) {
      const job = normalizeJob(jobDoc.data());

      if (!job) {
        tasks.push(() => removeInvalidJob(jobDoc.ref));
        continue;
      }

      tasks.push(() => reconcileProcessingJob(jobDoc.ref, job));
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
    const snapshot = await db
      .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
      .where('state', '==', 'CANCEL_REQUESTED')
      .limit(CANCELLATION_BATCH_SIZE)
      .get();
    const tasks: Array<() => Promise<void>> = [];

    for (const jobDoc of snapshot.docs) {
      const job = normalizeJob(jobDoc.data());

      if (!job) {
        tasks.push(() => removeInvalidJob(jobDoc.ref));
        continue;
      }

      tasks.push(() => processCancellation(jobDoc.ref, job));
    }

    await runBatch(tasks, 'cancel');
  }
);

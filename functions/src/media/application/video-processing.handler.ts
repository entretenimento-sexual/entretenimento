import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  deleteGoogleVideoTranscoderJob,
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
}

const SUBMISSION_BATCH_SIZE = 8;
const RECONCILIATION_BATCH_SIZE = 20;
const CANCELLATION_BATCH_SIZE = 20;
const SUBMISSION_LEASE_MS = 10 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

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

  if (!ownerUid || !videoId || !sourceStoragePath || !outputPrefix) {
    return null;
  }

  return {
    ownerUid,
    videoId,
    sourceStoragePath,
    sourcePosterStoragePath: String(job.sourcePosterStoragePath ?? '').trim() || null,
    sourceMimeType: String(job.sourceMimeType ?? '').trim().toLowerCase(),
    sourceSizeBytes: normalizePositiveInteger(job.sourceSizeBytes) ?? 0,
    sourceDurationMs: normalizePositiveInteger(job.sourceDurationMs),
    outputPrefix,
    processingVersion: cleanId(job.processingVersion),
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
    cancelRequestedAt: normalizeOptionalNonNegativeInteger(job.cancelRequestedAt),
    createdAt: normalizeNonNegativeInteger(job.createdAt),
    updatedAt: normalizeNonNegativeInteger(job.updatedAt),
    lastErrorCode: String(job.lastErrorCode ?? '').trim() || null,
    lastError: String(job.lastError ?? '').trim() || null,
  };
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

  return normalizeNonNegativeInteger(value);
}

function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(6, attempts - 1));
  return Math.min(MAX_RETRY_DELAY_MS, 60_000 * 2 ** exponent);
}

async function privateVideoStillMatches(job: VideoProcessingJob): Promise<boolean> {
  const snapshot = await db.doc(`users/${job.ownerUid}/videos/${job.videoId}`).get();

  if (!snapshot.exists) {
    return false;
  }

  const video = snapshot.data() as PrivateVideoDocument;
  const registeredPath =
    extractOwnedPrivateVideoPathForId(
      job.ownerUid,
      job.videoId,
      video.path
    ) ??
    extractOwnedPrivateVideoPathForId(
      job.ownerUid,
      job.videoId,
      video.url
    );

  return registeredPath === job.sourceStoragePath;
}

async function claimQueuedJob(
  jobRef: FirebaseFirestore.DocumentReference,
  now: number
): Promise<VideoProcessingJob | null> {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const job = snapshot.exists ? normalizeJob(snapshot.data()) : null;

    if (
      !job ||
      job.state !== 'QUEUED' ||
      job.nextAttemptAt > now
    ) {
      return null;
    }

    if (job.attempts >= VIDEO_PROCESSING_MAX_ATTEMPTS) {
      const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);
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
    const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);

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

async function submitClaimedJob(
  jobRef: FirebaseFirestore.DocumentReference,
  job: VideoProcessingJob
): Promise<void> {
  if (!(await privateVideoStillMatches(job))) {
    await requestCancellation(jobRef, job, 'SOURCE_NOT_REGISTERED');
    return;
  }

  try {
    const providerJob = await submitGoogleVideoTranscoderJob(job);
    const now = Date.now();
    const batch = db.batch();
    const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);

    batch.update(jobRef, {
      state: 'PROCESSING',
      externalJobName: providerJob.name,
      providerState: providerJob.state,
      submittedAt: now,
      leaseUntil: null,
      updatedAt: now,
      lastErrorCode: null,
      lastError: null,
    });
    batch.set(
      videoRef,
      {
        status: 'processing',
        processingStage: 'processing',
        processingErrorCode: null,
        processingErrorMessage: null,
        updatedAt: now,
      },
      { merge: true }
    );
    await batch.commit();
  } catch (error) {
    await handleSubmissionFailure(jobRef, job, error);
  }
}

async function handleSubmissionFailure(
  jobRef: FirebaseFirestore.DocumentReference,
  job: VideoProcessingJob,
  error: unknown
): Promise<void> {
  const normalized = normalizeGoogleTranscoderError(error);
  const now = Date.now();
  const canRetry =
    normalized.retryable &&
    job.attempts < VIDEO_PROCESSING_MAX_ATTEMPTS;
  const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);
  const batch = db.batch();

  if (canRetry) {
    batch.update(jobRef, {
      state: 'QUEUED',
      nextAttemptAt: now + retryDelayMs(job.attempts),
      leaseUntil: null,
      updatedAt: now,
      lastErrorCode: normalized.code,
      lastError: normalized.message,
    });
    batch.set(
      videoRef,
      {
        status: 'queued',
        processingStage: 'retry_wait',
        processingErrorCode: null,
        processingErrorMessage: null,
        updatedAt: now,
      },
      { merge: true }
    );
  } else {
    batch.update(jobRef, {
      state: 'FAILED',
      leaseUntil: null,
      completedAt: now,
      updatedAt: now,
      lastErrorCode: normalized.code,
      lastError: normalized.message,
    });
    batch.set(
      videoRef,
      {
        status: 'failed',
        processingStage: 'failed',
        processingErrorCode: normalized.code,
        processingErrorMessage:
          'Não foi possível preparar uma versão compatível deste vídeo.',
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();

  logger.warn('[videoProcessing] Falha ao enviar job.', {
    ownerUid: job.ownerUid,
    videoId: job.videoId,
    attempts: job.attempts,
    retryable: canRetry,
    errorCode: normalized.code,
    error: normalized.message,
  });
}

async function recoverExpiredSubmissionLeases(): Promise<void> {
  const now = Date.now();
  const snapshot = await db
    .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .where('state', '==', 'SUBMITTING')
    .limit(SUBMISSION_BATCH_SIZE)
    .get();

  await Promise.all(
    snapshot.docs.map(async (jobDoc) => {
      const job = normalizeJob(jobDoc.data());

      if (!job || !job.leaseUntil || job.leaseUntil > now) {
        return;
      }

      await jobDoc.ref.update({
        state: 'QUEUED',
        nextAttemptAt: now,
        leaseUntil: null,
        updatedAt: now,
        lastErrorCode: 'SUBMISSION_LEASE_EXPIRED',
        lastError: 'A submissão anterior não foi confirmada.',
      });
    })
  );
}

async function findProcessedVideoCandidate(
  job: VideoProcessingJob
): Promise<ProcessedVideoCandidate> {
  const [files] = await storage.bucket().getFiles({ prefix: job.outputPrefix });
  const candidates: ProcessedVideoCandidate[] = [];

  for (const file of files) {
    const [metadata] = await file.getMetadata();
    const mimeType = String(metadata.contentType ?? '').trim().toLowerCase();
    const sizeBytes = normalizePositiveInteger(metadata.size);

    if (
      sizeBytes &&
      (mimeType === 'video/mp4' || mimeType === 'video/webm')
    ) {
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
    throw new Error('O Transcoder concluiu sem gerar um derivado reproduzível.');
  }

  return candidate;
}

async function finalizeSucceededJob(
  jobRef: FirebaseFirestore.DocumentReference,
  job: VideoProcessingJob
): Promise<void> {
  const candidate = await findProcessedVideoCandidate(job);
  const now = Date.now();
  let cancellationRequested = false;

  await db.runTransaction(async (transaction) => {
    const [currentJobSnap, privateVideoSnap] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(db.doc(`users/${job.ownerUid}/videos/${job.videoId}`)),
    ]);
    const currentJob = currentJobSnap.exists
      ? normalizeJob(currentJobSnap.data())
      : null;

    if (
      !currentJob ||
      currentJob.state === 'CANCEL_REQUESTED' ||
      !privateVideoSnap.exists
    ) {
      cancellationRequested = true;
      return;
    }

    const privateVideo = privateVideoSnap.data() as PrivateVideoDocument;
    const sourcePath =
      extractOwnedPrivateVideoPathForId(
        job.ownerUid,
        job.videoId,
        privateVideo.path
      ) ??
      extractOwnedPrivateVideoPathForId(
        job.ownerUid,
        job.videoId,
        privateVideo.url
      );

    if (sourcePath !== job.sourceStoragePath) {
      cancellationRequested = true;
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
      privateVideoSnap.ref,
      {
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

  if (cancellationRequested) {
    await requestCancellation(jobRef, job, 'VIDEO_REMOVED_DURING_PROCESSING');
  }
}

async function markProviderFailure(
  jobRef: FirebaseFirestore.DocumentReference,
  job: VideoProcessingJob,
  errorCode: string | null,
  errorMessage: string | null
): Promise<void> {
  const now = Date.now();
  const batch = db.batch();
  const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);

  batch.update(jobRef, {
    state: 'FAILED',
    providerState: 'FAILED',
    completedAt: now,
    leaseUntil: null,
    updatedAt: now,
    lastErrorCode: errorCode || 'TRANSCODER_JOB_FAILED',
    lastError: errorMessage || 'O job de transcodificação falhou.',
  });
  batch.set(
    videoRef,
    {
      status: 'failed',
      processingStage: 'failed',
      processingErrorCode: errorCode || 'TRANSCODER_JOB_FAILED',
      processingErrorMessage:
        'Não foi possível preparar uma versão compatível deste vídeo.',
      updatedAt: now,
    },
    { merge: true }
  );
  await batch.commit();
}

async function reconcileProcessingJob(
  jobRef: FirebaseFirestore.DocumentReference,
  job: VideoProcessingJob
): Promise<void> {
  if (!job.externalJobName) {
    await handleSubmissionFailure(
      jobRef,
      job,
      new Error('Job externo ausente durante reconciliação.')
    );
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

async function requestCancellation(
  jobRef: FirebaseFirestore.DocumentReference,
  job: VideoProcessingJob,
  reason: string
): Promise<void> {
  const now = Date.now();

  await jobRef.set(
    {
      state: 'CANCEL_REQUESTED',
      cancelRequestedAt: job.cancelRequestedAt ?? now,
      leaseUntil: null,
      updatedAt: now,
      lastErrorCode: reason,
      lastError: 'O processamento foi cancelado porque o vídeo deixou de existir.',
    },
    { merge: true }
  );
}

async function deleteOutputPrefix(outputPrefix: string): Promise<void> {
  const [files] = await storage.bucket().getFiles({ prefix: outputPrefix });

  await Promise.all(
    files.map((file) => file.delete({ ignoreNotFound: true }))
  );
}

async function processCancellation(
  jobRef: FirebaseFirestore.DocumentReference,
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

export const submitQueuedVideoProcessing = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 5 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    await recoverExpiredSubmissionLeases();

    const now = Date.now();
    const snapshot = await db
      .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
      .where('state', '==', 'QUEUED')
      .limit(SUBMISSION_BATCH_SIZE)
      .get();

    for (const jobDoc of snapshot.docs) {
      const claimedJob = await claimQueuedJob(jobDoc.ref, now);

      if (claimedJob) {
        await submitClaimedJob(jobDoc.ref, claimedJob);
      }
    }
  }
);

export const reconcileVideoProcessing = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 5 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    const snapshot = await db
      .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
      .where('state', '==', 'PROCESSING')
      .limit(RECONCILIATION_BATCH_SIZE)
      .get();

    for (const jobDoc of snapshot.docs) {
      const job = normalizeJob(jobDoc.data());

      if (!job) {
        logger.error('[videoProcessing] Job inválido na reconciliação.', {
          jobId: jobDoc.id,
        });
        continue;
      }

      await reconcileProcessingJob(jobDoc.ref, job);
    }
  }
);

export const cleanupCancelledVideoProcessing = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 30 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    const snapshot = await db
      .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
      .where('state', '==', 'CANCEL_REQUESTED')
      .limit(CANCELLATION_BATCH_SIZE)
      .get();

    for (const jobDoc of snapshot.docs) {
      const job = normalizeJob(jobDoc.data());

      if (!job) {
        logger.error('[videoProcessing] Job inválido no cancelamento.', {
          jobId: jobDoc.id,
        });
        continue;
      }

      await processCancellation(jobDoc.ref, job);
    }
  }
);

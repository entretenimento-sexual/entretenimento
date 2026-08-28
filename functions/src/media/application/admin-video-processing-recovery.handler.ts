import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import {
  buildQueuedVideoProcessingJob,
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
  type VideoProcessingJobState,
} from './video-processing-job';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
  normalizeOwnedProcessedVideoPrefix,
} from './video-storage-path';

type AdminVideoProcessingRecoveryAction =
  | 'RETRY_FAILED'
  | 'RECHECK_STALE'
  | 'CANCEL_ACTIVE';

interface ListRecoveryJobsRequest {
  limit?: number;
}

interface RecoveryJobItem {
  jobId: string;
  ownerUid: string;
  videoId: string;
  state: VideoProcessingJobState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  ageMs: number;
  stale: boolean;
  hasExternalJob: boolean;
  lastErrorCode: string | null;
  lastError: string | null;
  availableActions: AdminVideoProcessingRecoveryAction[];
}

interface ListRecoveryJobsResponse {
  items: RecoveryJobItem[];
  skippedItems: number;
  checkedAt: number;
}

interface RecoverVideoProcessingRequest {
  ownerUid?: string;
  videoId?: string;
  action?: AdminVideoProcessingRecoveryAction;
  reason?: string;
  operationId?: string;
}

interface RecoverVideoProcessingResponse {
  ownerUid: string;
  videoId: string;
  previousState: VideoProcessingJobState;
  nextState: VideoProcessingJobState;
  action: AdminVideoProcessingRecoveryAction;
  alreadyApplied: boolean;
  cleanupPending: boolean;
}

interface PrivateVideoDocument {
  path?: string;
  url?: string;
  thumbnailPath?: string | null;
  thumbnailUrl?: string | null;
  processedStoragePath?: string | null;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number | null;
}

interface ProcessingCleanupJob {
  ownerUid: string;
  videoId: string;
  outputPrefix: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

const ACTIONABLE_STATES: VideoProcessingJobState[] = [
  'FAILED',
  'QUEUED',
  'SUBMITTING',
  'PROCESSING',
  'CANCEL_REQUESTED',
];
const STALE_AFTER_MS: Partial<Record<VideoProcessingJobState, number>> = {
  QUEUED: 20 * 60 * 1000,
  SUBMITTING: 20 * 60 * 1000,
  PROCESSING: 3 * 60 * 60 * 1000,
  CANCEL_REQUESTED: 90 * 60 * 1000,
};
const MAX_LIST_LIMIT = 60;
const DEFAULT_LIST_LIMIT = 30;
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MIN_VIDEO_DURATION_MS = 5_000;
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
const OUTPUT_CLEANUP_COLLECTION =
  'media_video_processing_output_cleanup_jobs';
const OUTPUT_CLEANUP_BATCH_SIZE = 30;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanOperationId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(normalized) ? normalized : '';
}

function cleanReason(value: unknown): string {
  return String(value ?? '').trim().slice(0, 900);
}

function normalizeAction(
  value: unknown
): AdminVideoProcessingRecoveryAction | null {
  const action = String(value ?? '').trim().toUpperCase();

  if (
    action === 'RETRY_FAILED' ||
    action === 'RECHECK_STALE' ||
    action === 'CANCEL_ACTIVE'
  ) {
    return action;
  }

  return null;
}

function normalizeState(value: unknown): VideoProcessingJobState | null {
  const state = String(value ?? '').trim().toUpperCase();

  return ACTIONABLE_STATES.includes(state as VideoProcessingJobState)
    ? state as VideoProcessingJobState
    : null;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue >= 0
    ? Math.trunc(numberValue)
    : 0;
}

function normalizePositiveInteger(value: unknown): number | null {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : null;
}

function normalizeLimit(value: unknown): number {
  const numberValue = Number(value ?? DEFAULT_LIST_LIMIT);

  if (!Number.isFinite(numberValue)) {
    return DEFAULT_LIST_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(numberValue)));
}

function assertAdmin(requestAuth: unknown): string {
  const authData = requestAuth as {
    uid?: unknown;
    token?: unknown;
  } | null | undefined;
  const adminUid = cleanId(authData?.uid);
  const token = typeof authData?.token === 'object' && authData.token !== null
    ? authData.token as Record<string, unknown>
    : {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  const allowed = token['admin'] === true ||
    token['role'] === 'admin' ||
    roles.includes('admin');

  if (!adminUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (!allowed) {
    throw new HttpsError(
      'permission-denied',
      'Apenas administradores podem recuperar o processamento de vídeos.'
    );
  }

  return adminUid;
}

function isStale(
  state: VideoProcessingJobState,
  updatedAt: number,
  checkedAt: number
): boolean {
  const threshold = STALE_AFTER_MS[state];
  return threshold !== undefined && checkedAt - updatedAt > threshold;
}

function availableActions(
  state: VideoProcessingJobState,
  stale: boolean
): AdminVideoProcessingRecoveryAction[] {
  if (state === 'FAILED') {
    return ['RETRY_FAILED'];
  }

  if (state === 'QUEUED' || state === 'SUBMITTING') {
    return stale
      ? ['RECHECK_STALE', 'CANCEL_ACTIVE']
      : ['CANCEL_ACTIVE'];
  }

  if (state === 'PROCESSING') {
    return ['CANCEL_ACTIVE'];
  }

  return [];
}

function normalizeRecoveryItem(
  jobId: string,
  data: unknown,
  checkedAt: number
): RecoveryJobItem | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const job = data as Partial<VideoProcessingJob> & {
    lastAdminOperationId?: unknown;
  };
  const ownerUid = cleanId(job.ownerUid);
  const videoId = cleanId(job.videoId);
  const state = normalizeState(job.state);

  if (!ownerUid || !videoId || !state) {
    return null;
  }

  const createdAt = normalizeNonNegativeInteger(job.createdAt);
  const updatedAt = normalizeNonNegativeInteger(job.updatedAt) || createdAt;
  const ageMs = Math.max(0, checkedAt - updatedAt);
  const stale = isStale(state, updatedAt, checkedAt);

  return {
    jobId,
    ownerUid,
    videoId,
    state,
    attempts: normalizeNonNegativeInteger(job.attempts),
    createdAt,
    updatedAt,
    ageMs,
    stale,
    hasExternalJob: !!String(job.externalJobName ?? '').trim(),
    lastErrorCode: String(job.lastErrorCode ?? '').trim() || null,
    lastError: String(job.lastError ?? '').trim().slice(0, 500) || null,
    availableActions: availableActions(state, stale),
  };
}

async function listRecoveryItems(
  limit: number,
  checkedAt: number
): Promise<{ items: RecoveryJobItem[]; skippedItems: number }> {
  const perStateLimit = Math.max(6, Math.ceil(limit / 2));
  const collection = db.collection(VIDEO_PROCESSING_JOBS_COLLECTION);
  const snapshots = await Promise.all(
    ACTIONABLE_STATES.map((state) =>
      collection.where('state', '==', state).limit(perStateLimit).get()
    )
  );
  const items: RecoveryJobItem[] = [];
  let skippedItems = 0;

  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      const item = normalizeRecoveryItem(document.id, document.data(), checkedAt);

      if (item) {
        items.push(item);
      } else {
        skippedItems += 1;
      }
    }
  }

  items.sort((left, right) => {
    if (left.state === 'FAILED' && right.state !== 'FAILED') {
      return -1;
    }

    if (right.state === 'FAILED' && left.state !== 'FAILED') {
      return 1;
    }

    return right.ageMs - left.ageMs;
  });

  return {
    items: items.slice(0, limit),
    skippedItems,
  };
}

function privateVideoSourcePath(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDocument
): string | null {
  return (
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url)
  );
}

function privatePosterPath(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDocument
): string | null {
  return (
    extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      video.thumbnailPath
    ) ??
    extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      video.thumbnailUrl
    )
  );
}

async function buildRetryJob(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDocument
): Promise<VideoProcessingJob> {
  const sourceStoragePath = privateVideoSourcePath(ownerUid, videoId, video);
  const sourcePosterStoragePath = privatePosterPath(ownerUid, videoId, video);

  if (!sourceStoragePath || String(video.processedStoragePath ?? '').trim()) {
    throw new HttpsError(
      'failed-precondition',
      'O vídeo privado não está elegível para novo processamento.'
    );
  }

  const [metadata] = await storage
    .bucket()
    .file(sourceStoragePath)
    .getMetadata();
  const sourceMimeType = String(metadata.contentType ?? video.mimeType ?? '')
    .trim()
    .toLowerCase();
  const sourceSizeBytes = normalizePositiveInteger(metadata.size ?? video.sizeBytes);
  const sourceDurationMs = normalizePositiveInteger(video.durationMs);

  if (
    !ALLOWED_VIDEO_TYPES.has(sourceMimeType) ||
    !sourceSizeBytes ||
    sourceSizeBytes > MAX_VIDEO_SIZE_BYTES ||
    (sourceDurationMs !== null && sourceDurationMs < MIN_VIDEO_DURATION_MS)
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A origem privada não atende aos requisitos de processamento.'
    );
  }

  return buildQueuedVideoProcessingJob({
    ownerUid,
    videoId,
    sourceStoragePath,
    sourcePosterStoragePath,
    sourceMimeType,
    sourceSizeBytes,
    sourceDurationMs,
  });
}

function cleanupJobId(jobId: string, processingVersion: string): string {
  return `${jobId}_${processingVersion}`.slice(0, 500);
}

async function retryFailedJob(command: {
  adminUid: string;
  ownerUid: string;
  videoId: string;
  operationId: string;
  reason: string;
}): Promise<RecoverVideoProcessingResponse> {
  const jobId = buildVideoProcessingJobId(command.ownerUid, command.videoId);
  const jobRef = db.collection(VIDEO_PROCESSING_JOBS_COLLECTION).doc(jobId);
  const videoRef = db.doc(`users/${command.ownerUid}/videos/${command.videoId}`);
  const [jobSnapshot, videoSnapshot] = await Promise.all([
    jobRef.get(),
    videoRef.get(),
  ]);

  if (!jobSnapshot.exists || !videoSnapshot.exists) {
    throw new HttpsError('not-found', 'Job ou vídeo privado não encontrado.');
  }

  const previousJob = jobSnapshot.data() as Partial<VideoProcessingJob>;
  const previousState = normalizeState(previousJob.state);

  if (previousState !== 'FAILED') {
    throw new HttpsError(
      'failed-precondition',
      'Somente jobs com falha podem ser reprocessados.'
    );
  }

  const retryJob = await buildRetryJob(
    command.ownerUid,
    command.videoId,
    videoSnapshot.data() as PrivateVideoDocument
  );
  const adminLogRef = db.collection('admin_logs').doc();
  const cleanupRef = db.collection(OUTPUT_CLEANUP_COLLECTION).doc(
    cleanupJobId(jobId, String(previousJob.processingVersion ?? 'legacy'))
  );

  return db.runTransaction(async (transaction) => {
    const [currentJobSnapshot, currentVideoSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(videoRef),
    ]);

    if (!currentJobSnapshot.exists || !currentVideoSnapshot.exists) {
      throw new HttpsError('not-found', 'Job ou vídeo privado não encontrado.');
    }

    const currentJob = currentJobSnapshot.data() as Partial<VideoProcessingJob> & {
      lastAdminOperationId?: string;
    };
    const currentState = normalizeState(currentJob.state);

    if (currentJob.lastAdminOperationId === command.operationId) {
      return {
        ownerUid: command.ownerUid,
        videoId: command.videoId,
        previousState: 'FAILED',
        nextState: currentState ?? 'QUEUED',
        action: 'RETRY_FAILED',
        alreadyApplied: true,
        cleanupPending: false,
      };
    }

    if (currentState !== 'FAILED') {
      throw new HttpsError(
        'failed-precondition',
        'O estado do job mudou antes da confirmação.'
      );
    }

    const currentVideo = currentVideoSnapshot.data() as PrivateVideoDocument;

    if (
      privateVideoSourcePath(command.ownerUid, command.videoId, currentVideo) !==
      retryJob.sourceStoragePath ||
      String(currentVideo.processedStoragePath ?? '').trim()
    ) {
      throw new HttpsError(
        'failed-precondition',
        'O arquivo privado mudou antes do reprocessamento.'
      );
    }

    const now = Date.now();
    transaction.set(jobRef, {
      ...retryJob,
      lastAdminOperationId: command.operationId,
      lastAdminAction: 'RETRY_FAILED',
      lastAdminBy: command.adminUid,
      lastAdminAt: now,
    });
    transaction.set(
      videoRef,
      {
        processingJobId: jobId,
        status: 'queued',
        processingStage: 'queued',
        processingErrorCode: null,
        processingErrorMessage: null,
        processedStoragePath: FieldValue.delete(),
        playbackPath: FieldValue.delete(),
        processedOutputPrefix: FieldValue.delete(),
        processedMimeType: FieldValue.delete(),
        processedSizeBytes: FieldValue.delete(),
        processingCompletedAt: FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true }
    );

    const previousPrefix = normalizeOwnedProcessedVideoPrefix(
      command.ownerUid,
      command.videoId,
      currentJob.outputPrefix
    );

    if (previousPrefix && previousPrefix !== retryJob.outputPrefix) {
      const cleanupJob: ProcessingCleanupJob = {
        ownerUid: command.ownerUid,
        videoId: command.videoId,
        outputPrefix: previousPrefix,
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        lastError: null,
      };
      transaction.set(cleanupRef, cleanupJob);
    }

    transaction.set(adminLogRef, {
      adminUid: command.adminUid,
      action: 'videoProcessingRecovery',
      targetUserUid: command.ownerUid,
      details: {
        videoId: command.videoId,
        operation: 'RETRY_FAILED',
        operationId: command.operationId,
        previousState: currentState,
        nextState: 'QUEUED',
        reason: command.reason,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return {
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      previousState: currentState,
      nextState: 'QUEUED',
      action: 'RETRY_FAILED',
      alreadyApplied: false,
      cleanupPending: !!previousPrefix,
    };
  });
}

async function mutateExistingJob(command: {
  adminUid: string;
  ownerUid: string;
  videoId: string;
  action: Exclude<AdminVideoProcessingRecoveryAction, 'RETRY_FAILED'>;
  operationId: string;
  reason: string;
}): Promise<RecoverVideoProcessingResponse> {
  const jobId = buildVideoProcessingJobId(command.ownerUid, command.videoId);
  const jobRef = db.collection(VIDEO_PROCESSING_JOBS_COLLECTION).doc(jobId);
  const videoRef = db.doc(`users/${command.ownerUid}/videos/${command.videoId}`);
  const adminLogRef = db.collection('admin_logs').doc();

  return db.runTransaction(async (transaction) => {
    const [jobSnapshot, videoSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(videoRef),
    ]);

    if (!jobSnapshot.exists || !videoSnapshot.exists) {
      throw new HttpsError('not-found', 'Job ou vídeo privado não encontrado.');
    }

    const job = jobSnapshot.data() as Partial<VideoProcessingJob> & {
      lastAdminOperationId?: string;
    };
    const state = normalizeState(job.state);

    if (!state) {
      throw new HttpsError('failed-precondition', 'Estado do job inválido.');
    }

    if (job.lastAdminOperationId === command.operationId) {
      return {
        ownerUid: command.ownerUid,
        videoId: command.videoId,
        previousState: state,
        nextState: state,
        action: command.action,
        alreadyApplied: true,
        cleanupPending: command.action === 'CANCEL_ACTIVE',
      };
    }

    const now = Date.now();
    let nextState: VideoProcessingJobState = state;
    const jobPatch: Record<string, unknown> = {
      lastAdminOperationId: command.operationId,
      lastAdminAction: command.action,
      lastAdminBy: command.adminUid,
      lastAdminAt: now,
      updatedAt: now,
    };
    const videoPatch: Record<string, unknown> = { updatedAt: now };

    if (command.action === 'RECHECK_STALE') {
      if (state !== 'QUEUED' && state !== 'SUBMITTING') {
        throw new HttpsError(
          'failed-precondition',
          'Somente jobs em fila ou submissão podem ser revalidados.'
        );
      }

      const updatedAt = normalizeNonNegativeInteger(job.updatedAt);

      if (!isStale(state, updatedAt, now)) {
        throw new HttpsError(
          'failed-precondition',
          'O job ainda não atingiu o limite de atraso para revalidação.'
        );
      }

      if (state === 'QUEUED') {
        jobPatch['nextAttemptAt'] = now;
        jobPatch['leaseUntil'] = null;
        videoPatch['status'] = 'queued';
        videoPatch['processingStage'] = 'queued';
      } else {
        jobPatch['leaseUntil'] = 0;
        videoPatch['status'] = 'processing';
        videoPatch['processingStage'] = 'confirming_submission';
      }
      jobPatch['lastErrorCode'] = null;
      jobPatch['lastError'] = null;
      videoPatch['processingErrorCode'] = null;
      videoPatch['processingErrorMessage'] = null;
    } else {
      if (
        state !== 'QUEUED' &&
        state !== 'SUBMITTING' &&
        state !== 'PROCESSING' &&
        state !== 'CANCEL_REQUESTED'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Este job não está ativo para cancelamento.'
        );
      }

      if (state === 'CANCEL_REQUESTED') {
        return {
          ownerUid: command.ownerUid,
          videoId: command.videoId,
          previousState: state,
          nextState: state,
          action: command.action,
          alreadyApplied: true,
          cleanupPending: true,
        };
      }

      nextState = 'CANCEL_REQUESTED';
      jobPatch['state'] = nextState;
      jobPatch['cancelRequestedAt'] = now;
      jobPatch['leaseUntil'] = null;
      jobPatch['lastErrorCode'] = 'ADMIN_CANCELLED';
      jobPatch['lastError'] = command.reason;
      videoPatch['status'] = 'failed';
      videoPatch['processingStage'] = 'failed';
      videoPatch['processingErrorCode'] = 'ADMIN_CANCELLED';
      videoPatch['processingErrorMessage'] =
        'O processamento foi cancelado pela administração.';
    }

    transaction.set(jobRef, jobPatch, { merge: true });
    transaction.set(videoRef, videoPatch, { merge: true });
    transaction.set(adminLogRef, {
      adminUid: command.adminUid,
      action: 'videoProcessingRecovery',
      targetUserUid: command.ownerUid,
      details: {
        videoId: command.videoId,
        operation: command.action,
        operationId: command.operationId,
        previousState: state,
        nextState,
        reason: command.reason,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return {
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      previousState: state,
      nextState,
      action: command.action,
      alreadyApplied: false,
      cleanupPending: command.action === 'CANCEL_ACTIVE',
    };
  });
}

function normalizeCleanupJob(data: unknown): ProcessingCleanupJob | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const job = data as Partial<ProcessingCleanupJob>;
  const ownerUid = cleanId(job.ownerUid);
  const videoId = cleanId(job.videoId);
  const outputPrefix = normalizeOwnedProcessedVideoPrefix(
    ownerUid,
    videoId,
    job.outputPrefix
  );

  if (!ownerUid || !videoId || !outputPrefix) {
    return null;
  }

  return {
    ownerUid,
    videoId,
    outputPrefix,
    createdAt: normalizeNonNegativeInteger(job.createdAt),
    updatedAt: normalizeNonNegativeInteger(job.updatedAt),
    attempts: normalizeNonNegativeInteger(job.attempts),
    lastError: String(job.lastError ?? '').trim().slice(0, 500) || null,
  };
}

async function deleteOutputPrefix(outputPrefix: string): Promise<void> {
  const [files] = await storage.bucket().getFiles({ prefix: outputPrefix });
  await Promise.all(
    files.map((file) => file.delete({ ignoreNotFound: true }))
  );
}

export const listVideoProcessingRecoveryJobs = onCall<ListRecoveryJobsRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ListRecoveryJobsResponse> => {
    assertAdmin(request.auth);
    const checkedAt = Date.now();
    const limit = normalizeLimit(request.data?.limit);
    const result = await listRecoveryItems(limit, checkedAt);

    return {
      ...result,
      checkedAt,
    };
  }
);

export const recoverVideoProcessingJob = onCall<RecoverVideoProcessingRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RecoverVideoProcessingResponse> => {
    const adminUid = assertAdmin(request.auth);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const action = normalizeAction(request.data?.action);
    const operationId = cleanOperationId(request.data?.operationId);
    const reason = cleanReason(request.data?.reason);

    if (!ownerUid || !videoId || !action || !operationId) {
      throw new HttpsError('invalid-argument', 'Comando de recuperação inválido.');
    }

    if (reason.length < 8) {
      throw new HttpsError(
        'invalid-argument',
        'Informe uma justificativa objetiva, com pelo menos 8 caracteres.'
      );
    }

    try {
      if (action === 'RETRY_FAILED') {
        return await retryFailedJob({
          adminUid,
          ownerUid,
          videoId,
          operationId,
          reason,
        });
      }

      return await mutateExistingJob({
        adminUid,
        ownerUid,
        videoId,
        action,
        operationId,
        reason,
      });
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      logger.error('[videoProcessingRecovery] Falha administrativa.', {
        adminUid,
        ownerUid,
        videoId,
        action,
        error: error instanceof Error ? error.message : String(error ?? ''),
      });
      throw new HttpsError(
        'internal',
        'Não foi possível concluir a recuperação do processamento.'
      );
    }
  }
);

export const cleanupRetriedVideoProcessingOutputs = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const snapshot = await db
      .collection(OUTPUT_CLEANUP_COLLECTION)
      .limit(OUTPUT_CLEANUP_BATCH_SIZE)
      .get();

    for (const document of snapshot.docs) {
      const job = normalizeCleanupJob(document.data());

      if (!job) {
        logger.error('[videoProcessingCleanup] Job inválido.', {
          jobId: document.id,
        });
        continue;
      }

      try {
        await deleteOutputPrefix(job.outputPrefix);
        await document.ref.delete();
      } catch (error) {
        await document.ref.set(
          {
            attempts: FieldValue.increment(1),
            updatedAt: Date.now(),
            lastError: error instanceof Error
              ? error.message.slice(0, 500)
              : String(error ?? '').slice(0, 500),
          },
          { merge: true }
        );
        logger.warn('[videoProcessingCleanup] Limpeza pendente.', {
          jobId: document.id,
          ownerUid: job.ownerUid,
          videoId: job.videoId,
          error: error instanceof Error ? error.message : String(error ?? ''),
        });
      }
    }
  }
);

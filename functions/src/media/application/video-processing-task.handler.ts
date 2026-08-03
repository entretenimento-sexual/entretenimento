import { createHash } from 'node:crypto';

import { getFunctions } from 'firebase-admin/functions';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { adminApp, db } from '../../firebaseApp';
import {
  executeVideoProcessingDispatch,
} from './video-processing-core.service';
import {
  buildVideoProcessingDispatchPayload,
  resolveVideoProcessingDispatch,
  type VideoProcessingDispatch,
  type VideoProcessingDispatchMode,
  type VideoProcessingDispatchPayload,
} from './video-processing-dispatch.policy';
import {
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';

interface VideoProcessingDispatchDocument
  extends VideoProcessingDispatchPayload {
  state:
    | 'ENQUEUEING'
    | 'ENQUEUED'
    | 'COMPLETED'
    | 'FAILED'
    | 'EMULATOR_SKIPPED';
  scheduleAt: number;
  taskId: string;
  taskAlreadyExisted: boolean;
  createdAt: number;
  updatedAt: number;
  enqueuedAt: number | null;
  completedAt: number | null;
  lastError: string | null;
}

interface VideoProcessingDeadLetterDocument {
  deadLetterId: string;
  jobId: string;
  ownerUid: string;
  videoId: string;
  processingVersion: string;
  state: 'FAILED';
  attempts: number;
  providerState: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  createdAt: number;
  failedAt: number;
  recordedAt: number;
  updatedAt: number;
}

const DISPATCH_COLLECTION = 'media_video_processing_dispatches';
const DEAD_LETTER_COLLECTION = 'media_video_processing_dead_letters';
const TASK_FUNCTION_NAME = 'processVideoProcessingTask';
const TASK_RESOURCE_NAME =
  `locations/${FUNCTIONS_REGION}/functions/${TASK_FUNCTION_NAME}`;
const TASK_DISPATCH_DEADLINE_SECONDS = 540;
const MAX_ERROR_LENGTH = 500;

const taskQueue = getFunctions(adminApp).taskQueue<
  VideoProcessingDispatchPayload
>(TASK_RESOURCE_NAME, { scope: 'current' });

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizePositiveInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function normalizeMode(value: unknown): VideoProcessingDispatchMode | null {
  const mode = String(value ?? '').trim().toUpperCase();

  if (
    mode === 'SUBMIT' ||
    mode === 'RECOVER_SUBMISSION' ||
    mode === 'RECONCILE' ||
    mode === 'CANCEL'
  ) {
    return mode;
  }

  return null;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, MAX_ERROR_LENGTH);
  }

  return String(error ?? 'unknown').slice(0, MAX_ERROR_LENGTH);
}

function isTaskAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const code = String((error as { code?: unknown }).code ?? '')
    .trim()
    .toLowerCase();

  return code === 'task-already-exists' ||
    code.endsWith('/task-already-exists');
}

function normalizePayload(
  value: VideoProcessingDispatchPayload | null | undefined
): VideoProcessingDispatchPayload {
  const dispatchId = String(value?.dispatchId ?? '').trim();
  const jobId = cleanId(value?.jobId);
  const processingVersion = cleanId(value?.processingVersion);
  const mode = normalizeMode(value?.mode);
  const dueAt = normalizePositiveInteger(value?.dueAt);

  if (
    !/^video-processing-[a-f0-9]{64}$/.test(dispatchId) ||
    !jobId ||
    !processingVersion ||
    !mode ||
    !dueAt
  ) {
    throw new Error('Payload da task de processamento inválido.');
  }

  return {
    dispatchId,
    jobId,
    processingVersion,
    mode,
    dueAt,
  };
}

function dispatchReference(dispatchId: string) {
  return db.collection(DISPATCH_COLLECTION).doc(dispatchId);
}

function deadLetterId(jobId: string, processingVersion: string): string {
  return createHash('sha256')
    .update(`${jobId}:${processingVersion}`)
    .digest('hex');
}

async function recordDeadLetter(
  jobId: string,
  job: Partial<VideoProcessingJob>
): Promise<void> {
  const ownerUid = cleanId(job.ownerUid);
  const videoId = cleanId(job.videoId);
  const processingVersion = cleanId(job.processingVersion);

  if (!ownerUid || !videoId || !processingVersion) {
    logger.error('[videoProcessingTask] Falha sem identidade para DLQ.', {
      jobId,
    });
    return;
  }

  const now = Date.now();
  const id = deadLetterId(jobId, processingVersion);
  const document: VideoProcessingDeadLetterDocument = {
    deadLetterId: id,
    jobId,
    ownerUid,
    videoId,
    processingVersion,
    state: 'FAILED',
    attempts: normalizeNonNegativeInteger(job.attempts),
    providerState: String(job.providerState ?? '').trim() || null,
    lastErrorCode: String(job.lastErrorCode ?? '').trim().slice(0, 120) || null,
    lastError: String(job.lastError ?? '').trim().slice(0, MAX_ERROR_LENGTH) || null,
    createdAt: normalizeNonNegativeInteger(job.createdAt),
    failedAt:
      normalizeNonNegativeInteger(job.completedAt) ||
      normalizeNonNegativeInteger(job.updatedAt) ||
      now,
    recordedAt: now,
    updatedAt: now,
  };

  await db.collection(DEAD_LETTER_COLLECTION).doc(id).set(
    document,
    { merge: true }
  );
}

async function persistDispatchBeforeEnqueue(
  dispatch: VideoProcessingDispatch
): Promise<void> {
  const now = Date.now();
  const document: VideoProcessingDispatchDocument = {
    ...buildVideoProcessingDispatchPayload(dispatch),
    state: 'ENQUEUEING',
    scheduleAt: dispatch.scheduleAt,
    taskId: dispatch.taskId,
    taskAlreadyExisted: false,
    createdAt: now,
    updatedAt: now,
    enqueuedAt: null,
    completedAt: null,
    lastError: null,
  };

  await dispatchReference(dispatch.dispatchId).set(document, { merge: true });
}

async function enqueueDispatch(
  dispatch: VideoProcessingDispatch
): Promise<void> {
  await persistDispatchBeforeEnqueue(dispatch);

  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    await dispatchReference(dispatch.dispatchId).set(
      {
        state: 'EMULATOR_SKIPPED',
        updatedAt: Date.now(),
        completedAt: Date.now(),
      },
      { merge: true }
    );
    return;
  }

  let taskAlreadyExisted = false;

  try {
    await taskQueue.enqueue(
      buildVideoProcessingDispatchPayload(dispatch),
      {
        id: dispatch.taskId,
        scheduleTime: new Date(dispatch.scheduleAt),
        dispatchDeadlineSeconds: TASK_DISPATCH_DEADLINE_SECONDS,
      }
    );
  } catch (error) {
    if (!isTaskAlreadyExistsError(error)) {
      await dispatchReference(dispatch.dispatchId).set(
        {
          state: 'FAILED',
          updatedAt: Date.now(),
          lastError: normalizeErrorMessage(error),
        },
        { merge: true }
      );
      throw error;
    }

    taskAlreadyExisted = true;
  }

  const now = Date.now();
  await dispatchReference(dispatch.dispatchId).set(
    {
      state: 'ENQUEUED',
      taskAlreadyExisted,
      enqueuedAt: now,
      updatedAt: now,
      lastError: null,
    },
    { merge: true }
  );
}

export const dispatchVideoProcessingOnJobWrite = onDocumentWritten(
  {
    document: `${VIDEO_PROCESSING_JOBS_COLLECTION}/{jobId}`,
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    if (!event.data?.after.exists) {
      return;
    }

    const jobId = cleanId(event.params.jobId);
    const job = event.data.after.data() as Partial<VideoProcessingJob>;

    if (!jobId) {
      logger.error('[videoProcessingTask] Job sem identificador válido.');
      return;
    }

    if (String(job.state ?? '').trim().toUpperCase() === 'FAILED') {
      await recordDeadLetter(jobId, job);
      return;
    }

    const dispatch = resolveVideoProcessingDispatch(jobId, job);

    if (!dispatch) {
      return;
    }

    await enqueueDispatch(dispatch);
  }
);

export const processVideoProcessingTask = onTaskDispatched<
  VideoProcessingDispatchPayload
>(
  {
    region: FUNCTIONS_REGION,
    timeoutSeconds: TASK_DISPATCH_DEADLINE_SECONDS,
    memory: '512MiB',
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 30,
      maxBackoffSeconds: 15 * 60,
      maxDoublings: 4,
      maxRetrySeconds: 6 * 60 * 60,
    },
    rateLimits: {
      maxConcurrentDispatches: 4,
      maxDispatchesPerSecond: 2,
    },
  },
  async (request) => {
    const payload = normalizePayload(request.data);
    const dispatchRef = dispatchReference(payload.dispatchId);

    try {
      await executeVideoProcessingDispatch({
        jobId: payload.jobId,
        processingVersion: payload.processingVersion,
        mode: payload.mode,
      });
      const now = Date.now();

      await dispatchRef.set(
        {
          state: 'COMPLETED',
          completedAt: now,
          updatedAt: now,
          lastError: null,
        },
        { merge: true }
      );
    } catch (error) {
      await dispatchRef.set(
        {
          state: 'FAILED',
          updatedAt: Date.now(),
          lastError: normalizeErrorMessage(error),
        },
        { merge: true }
      ).catch(() => undefined);

      logger.error('[videoProcessingTask] Execução da task falhou.', {
        dispatchId: payload.dispatchId,
        jobId: payload.jobId,
        processingVersion: payload.processingVersion,
        mode: payload.mode,
        error: normalizeErrorMessage(error),
      });
      throw error;
    }
  }
);

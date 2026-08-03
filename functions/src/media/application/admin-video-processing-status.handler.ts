import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  buildVideoProcessingDispatchMetrics,
  resolveVideoProcessingHealth,
  summarizeVideoProcessingFailureCodes,
  VIDEO_PROCESSING_DEAD_LETTER_SAMPLE_LIMIT,
  VIDEO_PROCESSING_DISPATCH_SAMPLE_LIMIT,
  VIDEO_PROCESSING_OBSERVABILITY_WINDOW_MS,
  type VideoProcessingAlert,
  type VideoProcessingDispatchCounts,
  type VideoProcessingDispatchMetrics,
  type VideoProcessingDispatchRecord,
  type VideoProcessingDispatchState,
  type VideoProcessingFailureCodeSummary,
  type VideoProcessingOperationalState,
} from './admin-video-processing-observability.policy';
import {
  probeGoogleVideoTranscoder,
  type GoogleVideoTranscoderProbeResult,
} from './google-video-transcoder.service';
import {
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJobState,
} from './video-processing-job';

type JobStateCounts = Record<VideoProcessingJobState, number>;

interface VideoProcessingQueueSnapshot {
  counts: JobStateCounts;
  activeTotal: number;
  sampledActiveJobs: number;
  oldestActiveAgeMs: number | null;
  staleSampledJobs: number;
  sampleCapped: boolean;
}

interface VideoProcessingDeadLetterItem {
  deadLetterId: string;
  jobId: string;
  ownerUid: string;
  videoId: string;
  processingVersion: string;
  attempts: number;
  providerState: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  failedAt: number;
}

interface VideoProcessingDeadLetterSnapshot {
  total: number;
  recentWindowMs: number;
  recentTotal: number;
  sampledItems: number;
  sampleCapped: boolean;
  failureCodes: VideoProcessingFailureCodeSummary[];
  items: VideoProcessingDeadLetterItem[];
}

interface VideoProcessingAuditItem {
  logId: string;
  adminUid: string;
  ownerUid: string;
  videoId: string;
  operation: string;
  operationId: string;
  previousState: string | null;
  nextState: string | null;
  reason: string;
  timestamp: number;
}

interface VideoProcessingAuditSnapshot {
  items: VideoProcessingAuditItem[];
  skippedItems: number;
  sampleCapped: boolean;
}

interface AdminVideoProcessingStatusResponse {
  state: VideoProcessingOperationalState;
  checkedAt: number;
  provider: GoogleVideoTranscoderProbeResult;
  queue: VideoProcessingQueueSnapshot;
  dispatch: VideoProcessingDispatchMetrics;
  deadLetters: VideoProcessingDeadLetterSnapshot;
  audit: VideoProcessingAuditSnapshot;
  alerts: VideoProcessingAlert[];
}

interface ProcessingJobSnapshot {
  state?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface ProcessingDispatchDocument {
  state?: unknown;
  mode?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  enqueuedAt?: unknown;
  completedAt?: unknown;
  taskAlreadyExisted?: unknown;
}

interface ProcessingDeadLetterDocument {
  deadLetterId?: unknown;
  jobId?: unknown;
  ownerUid?: unknown;
  videoId?: unknown;
  processingVersion?: unknown;
  attempts?: unknown;
  providerState?: unknown;
  lastErrorCode?: unknown;
  lastError?: unknown;
  failedAt?: unknown;
}

interface AdminLogDocument {
  adminUid?: unknown;
  action?: unknown;
  targetUserUid?: unknown;
  details?: unknown;
  timestamp?: unknown;
}

const JOB_STATES: VideoProcessingJobState[] = [
  'QUEUED',
  'SUBMITTING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
];
const ACTIVE_JOB_STATES: VideoProcessingJobState[] = [
  'QUEUED',
  'SUBMITTING',
  'PROCESSING',
  'CANCEL_REQUESTED',
];
const DISPATCH_STATES: VideoProcessingDispatchState[] = [
  'ENQUEUEING',
  'ENQUEUED',
  'COMPLETED',
  'FAILED',
  'EMULATOR_SKIPPED',
];
const ACTIVE_SAMPLE_LIMIT = 100;
const DEAD_LETTER_ITEM_LIMIT = 12;
const AUDIT_SAMPLE_LIMIT = 20;
const DISPATCH_COLLECTION = 'media_video_processing_dispatches';
const DEAD_LETTER_COLLECTION = 'media_video_processing_dead_letters';
const STALE_AFTER_MS: Record<VideoProcessingJobState, number> = {
  QUEUED: 20 * 60 * 1000,
  SUBMITTING: 20 * 60 * 1000,
  PROCESSING: 3 * 60 * 60 * 1000,
  SUCCEEDED: Number.POSITIVE_INFINITY,
  FAILED: Number.POSITIVE_INFINITY,
  CANCEL_REQUESTED: 90 * 60 * 1000,
  CANCELLED: Number.POSITIVE_INFINITY,
};

function cleanEntityId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanJobId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,300}$/.test(normalized) ? normalized : '';
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

function assertAdmin(requestAuth: unknown): string {
  const authData = requestAuth as {
    uid?: unknown;
    token?: unknown;
  } | null | undefined;
  const adminUid = cleanEntityId(authData?.uid);
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
      'Apenas administradores podem consultar o processamento de vídeos.'
    );
  }

  return adminUid;
}

function normalizeJobState(value: unknown): VideoProcessingJobState | null {
  const normalized = String(value ?? '').trim().toUpperCase();

  return JOB_STATES.includes(normalized as VideoProcessingJobState)
    ? normalized as VideoProcessingJobState
    : null;
}

function normalizeDispatchState(
  value: unknown
): VideoProcessingDispatchState | null {
  const normalized = String(value ?? '').trim().toUpperCase();

  return DISPATCH_STATES.includes(normalized as VideoProcessingDispatchState)
    ? normalized as VideoProcessingDispatchState
    : null;
}

function toMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }

  const timestamp = value as {
    toMillis?: () => number;
  } | null | undefined;

  if (typeof timestamp?.toMillis === 'function') {
    const millis = timestamp.toMillis();
    return Number.isFinite(millis) && millis >= 0 ? Math.trunc(millis) : null;
  }

  return null;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue >= 0
    ? Math.trunc(numberValue)
    : 0;
}

function emptyJobCounts(): JobStateCounts {
  return {
    QUEUED: 0,
    SUBMITTING: 0,
    PROCESSING: 0,
    SUCCEEDED: 0,
    FAILED: 0,
    CANCEL_REQUESTED: 0,
    CANCELLED: 0,
  };
}

function emptyDispatchCounts(): VideoProcessingDispatchCounts {
  return {
    ENQUEUEING: 0,
    ENQUEUED: 0,
    COMPLETED: 0,
    FAILED: 0,
    EMULATOR_SKIPPED: 0,
  };
}

async function readJobCounts(): Promise<JobStateCounts> {
  const collection = db.collection(VIDEO_PROCESSING_JOBS_COLLECTION);
  const counts = emptyJobCounts();
  const snapshots = await Promise.all(
    JOB_STATES.map((state) =>
      collection.where('state', '==', state).count().get()
    )
  );

  snapshots.forEach((snapshot, index) => {
    const state = JOB_STATES[index];
    counts[state] = normalizeNonNegativeInteger(snapshot.data().count);
  });

  return counts;
}

async function readActiveSample(
  checkedAt: number,
  counts: JobStateCounts
): Promise<Omit<VideoProcessingQueueSnapshot, 'counts' | 'activeTotal'>> {
  const snapshot = await db
    .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .where('state', 'in', ACTIVE_JOB_STATES)
    .limit(ACTIVE_SAMPLE_LIMIT)
    .get();
  let oldestActiveAgeMs: number | null = null;
  let staleSampledJobs = 0;

  for (const document of snapshot.docs) {
    const job = document.data() as ProcessingJobSnapshot;
    const state = normalizeJobState(job.state);

    if (!state || !ACTIVE_JOB_STATES.includes(state)) {
      continue;
    }

    const timestamp = toMillis(job.updatedAt) ?? toMillis(job.createdAt);

    if (timestamp === null) {
      staleSampledJobs += 1;
      continue;
    }

    const ageMs = Math.max(0, checkedAt - timestamp);
    oldestActiveAgeMs = oldestActiveAgeMs === null
      ? ageMs
      : Math.max(oldestActiveAgeMs, ageMs);

    if (ageMs > STALE_AFTER_MS[state]) {
      staleSampledJobs += 1;
    }
  }

  const activeTotal = ACTIVE_JOB_STATES.reduce(
    (total, state) => total + counts[state],
    0
  );

  return {
    sampledActiveJobs: snapshot.size,
    oldestActiveAgeMs,
    staleSampledJobs,
    sampleCapped: activeTotal > snapshot.size,
  };
}

async function readDispatchCounts(): Promise<VideoProcessingDispatchCounts> {
  const collection = db.collection(DISPATCH_COLLECTION);
  const counts = emptyDispatchCounts();
  const snapshots = await Promise.all(
    DISPATCH_STATES.map((state) =>
      collection.where('state', '==', state).count().get()
    )
  );

  snapshots.forEach((snapshot, index) => {
    const state = DISPATCH_STATES[index];
    counts[state] = normalizeNonNegativeInteger(snapshot.data().count);
  });

  return counts;
}

function normalizeDispatchRecord(
  data: ProcessingDispatchDocument
): VideoProcessingDispatchRecord | null {
  const state = normalizeDispatchState(data.state);

  if (!state) {
    return null;
  }

  return {
    state,
    mode: cleanText(data.mode, 80),
    createdAt: toMillis(data.createdAt) ?? 0,
    updatedAt: toMillis(data.updatedAt) ?? 0,
    enqueuedAt: toMillis(data.enqueuedAt),
    completedAt: toMillis(data.completedAt),
    taskAlreadyExisted: data.taskAlreadyExisted === true,
  };
}

async function readDispatchMetrics(
  checkedAt: number
): Promise<VideoProcessingDispatchMetrics> {
  const [counts, snapshot] = await Promise.all([
    readDispatchCounts(),
    db.collection(DISPATCH_COLLECTION)
      .orderBy('updatedAt', 'desc')
      .limit(VIDEO_PROCESSING_DISPATCH_SAMPLE_LIMIT)
      .get(),
  ]);
  const records = snapshot.docs
    .map((document) =>
      normalizeDispatchRecord(document.data() as ProcessingDispatchDocument)
    )
    .filter((record): record is VideoProcessingDispatchRecord => !!record);

  return buildVideoProcessingDispatchMetrics({
    records,
    counts,
    checkedAt,
    sampleLimit: VIDEO_PROCESSING_DISPATCH_SAMPLE_LIMIT,
  });
}

function normalizeDeadLetterItem(
  documentId: string,
  data: ProcessingDeadLetterDocument
): VideoProcessingDeadLetterItem | null {
  const deadLetterId = cleanText(data.deadLetterId, 128) ||
    cleanText(documentId, 128);
  const jobId = cleanJobId(data.jobId);
  const ownerUid = cleanEntityId(data.ownerUid);
  const videoId = cleanEntityId(data.videoId);
  const processingVersion = cleanEntityId(data.processingVersion);

  if (!deadLetterId || !jobId || !ownerUid || !videoId || !processingVersion) {
    return null;
  }

  return {
    deadLetterId,
    jobId,
    ownerUid,
    videoId,
    processingVersion,
    attempts: normalizeNonNegativeInteger(data.attempts),
    providerState: cleanText(data.providerState, 160) || null,
    errorCode: cleanText(data.lastErrorCode, 120) || null,
    errorMessage: cleanText(data.lastError, 500) || null,
    failedAt: toMillis(data.failedAt) ?? 0,
  };
}

async function readDeadLetterSnapshot(
  checkedAt: number
): Promise<VideoProcessingDeadLetterSnapshot> {
  const collection = db.collection(DEAD_LETTER_COLLECTION);
  const recentThreshold = checkedAt - VIDEO_PROCESSING_OBSERVABILITY_WINDOW_MS;
  const [totalSnapshot, recentSnapshot, sampleSnapshot] = await Promise.all([
    collection.count().get(),
    collection.where('failedAt', '>=', recentThreshold).count().get(),
    collection
      .orderBy('failedAt', 'desc')
      .limit(VIDEO_PROCESSING_DEAD_LETTER_SAMPLE_LIMIT)
      .get(),
  ]);
  const normalizedItems = sampleSnapshot.docs
    .map((document) =>
      normalizeDeadLetterItem(
        document.id,
        document.data() as ProcessingDeadLetterDocument
      )
    )
    .filter((item): item is VideoProcessingDeadLetterItem => !!item);

  return {
    total: normalizeNonNegativeInteger(totalSnapshot.data().count),
    recentWindowMs: VIDEO_PROCESSING_OBSERVABILITY_WINDOW_MS,
    recentTotal: normalizeNonNegativeInteger(recentSnapshot.data().count),
    sampledItems: normalizedItems.length,
    sampleCapped:
      sampleSnapshot.size >= VIDEO_PROCESSING_DEAD_LETTER_SAMPLE_LIMIT,
    failureCodes: summarizeVideoProcessingFailureCodes(
      normalizedItems.map((item) => ({
        errorCode: item.errorCode,
        failedAt: item.failedAt,
      }))
    ),
    items: normalizedItems.slice(0, DEAD_LETTER_ITEM_LIMIT),
  };
}

function normalizeAuditItem(
  documentId: string,
  data: AdminLogDocument
): VideoProcessingAuditItem | null {
  if (cleanText(data.action, 120) !== 'videoProcessingRecovery') {
    return null;
  }

  const details = typeof data.details === 'object' && data.details !== null
    ? data.details as Record<string, unknown>
    : {};
  const adminUid = cleanEntityId(data.adminUid);
  const ownerUid = cleanEntityId(data.targetUserUid);
  const videoId = cleanEntityId(details['videoId']);
  const operation = cleanText(details['operation'], 80);
  const operationId = cleanText(details['operationId'], 128);
  const reason = cleanText(details['reason'], 900);

  if (!adminUid || !ownerUid || !videoId || !operation || !operationId) {
    return null;
  }

  return {
    logId: cleanText(documentId, 128),
    adminUid,
    ownerUid,
    videoId,
    operation,
    operationId,
    previousState: cleanText(details['previousState'], 80) || null,
    nextState: cleanText(details['nextState'], 80) || null,
    reason,
    timestamp: toMillis(data.timestamp) ?? 0,
  };
}

async function readAuditSnapshot(): Promise<VideoProcessingAuditSnapshot> {
  const snapshot = await db.collection('admin_logs')
    .where('action', '==', 'videoProcessingRecovery')
    .orderBy('timestamp', 'desc')
    .limit(AUDIT_SAMPLE_LIMIT)
    .get();
  const items: VideoProcessingAuditItem[] = [];
  let skippedItems = 0;

  for (const document of snapshot.docs) {
    const item = normalizeAuditItem(
      document.id,
      document.data() as AdminLogDocument
    );

    if (item) {
      items.push(item);
    } else {
      skippedItems += 1;
    }
  }

  return {
    items,
    skippedItems,
    sampleCapped: snapshot.size >= AUDIT_SAMPLE_LIMIT,
  };
}

export const getVideoProcessingOperationalStatus = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<AdminVideoProcessingStatusResponse> => {
    const adminUid = assertAdmin(request.auth);
    const checkedAt = Date.now();

    try {
      const [provider, counts, dispatch, deadLetters, audit] =
        await Promise.all([
          probeGoogleVideoTranscoder(),
          readJobCounts(),
          readDispatchMetrics(checkedAt),
          readDeadLetterSnapshot(checkedAt),
          readAuditSnapshot(),
        ]);
      const activeTotal = ACTIVE_JOB_STATES.reduce(
        (total, state) => total + counts[state],
        0
      );
      const activeSample = await readActiveSample(checkedAt, counts);
      const queue: VideoProcessingQueueSnapshot = {
        counts,
        activeTotal,
        ...activeSample,
      };
      const health = resolveVideoProcessingHealth({
        providerStatus: provider.status,
        staleSampledJobs: queue.staleSampledJobs,
        activeSampleCapped: queue.sampleCapped,
        dispatch,
        recentDeadLetters: deadLetters.recentTotal,
      });

      if (health.state === 'DEGRADED') {
        logger.warn('[videoProcessingStatus] Operação degradada.', {
          adminUid,
          providerStatus: provider.status,
          activeTotal,
          staleSampledJobs: queue.staleSampledJobs,
          failedDispatches: dispatch.counts.FAILED,
          recentDeadLetters: deadLetters.recentTotal,
          alertCodes: health.alerts.map((alert) => alert.code),
        });
      }

      return {
        state: health.state,
        checkedAt,
        provider,
        queue,
        dispatch,
        deadLetters,
        audit,
        alerts: health.alerts,
      };
    } catch (error) {
      logger.error('[videoProcessingStatus] Falha no diagnóstico.', {
        adminUid,
        error: error instanceof Error
          ? error.message
          : String(error ?? ''),
      });

      throw new HttpsError(
        'internal',
        'Não foi possível consultar o estado operacional dos vídeos.'
      );
    }
  }
);

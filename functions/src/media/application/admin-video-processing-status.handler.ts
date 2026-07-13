import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  probeGoogleVideoTranscoder,
  type GoogleVideoTranscoderProbeResult,
} from './google-video-transcoder.service';
import {
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJobState,
} from './video-processing-job';

type VideoProcessingOperationalState = 'READY' | 'DEGRADED' | 'EMULATOR';

type JobStateCounts = Record<VideoProcessingJobState, number>;

interface VideoProcessingQueueSnapshot {
  counts: JobStateCounts;
  activeTotal: number;
  sampledActiveJobs: number;
  oldestActiveAgeMs: number | null;
  staleSampledJobs: number;
  sampleCapped: boolean;
}

interface AdminVideoProcessingStatusResponse {
  state: VideoProcessingOperationalState;
  checkedAt: number;
  provider: GoogleVideoTranscoderProbeResult;
  queue: VideoProcessingQueueSnapshot;
}

interface ProcessingJobSnapshot {
  state?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
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
const ACTIVE_SAMPLE_LIMIT = 100;
const STALE_AFTER_MS: Record<VideoProcessingJobState, number> = {
  QUEUED: 20 * 60 * 1000,
  SUBMITTING: 20 * 60 * 1000,
  PROCESSING: 3 * 60 * 60 * 1000,
  SUCCEEDED: Number.POSITIVE_INFINITY,
  FAILED: Number.POSITIVE_INFINITY,
  CANCEL_REQUESTED: 90 * 60 * 1000,
  CANCELLED: Number.POSITIVE_INFINITY,
};

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
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
      'Apenas administradores podem consultar o processamento de vídeos.'
    );
  }

  return adminUid;
}

function normalizeState(value: unknown): VideoProcessingJobState | null {
  const normalized = String(value ?? '').trim().toUpperCase();

  return JOB_STATES.includes(normalized as VideoProcessingJobState)
    ? normalized as VideoProcessingJobState
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

function emptyCounts(): JobStateCounts {
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

async function readJobCounts(): Promise<JobStateCounts> {
  const collection = db.collection(VIDEO_PROCESSING_JOBS_COLLECTION);
  const counts = emptyCounts();
  const snapshots = await Promise.all(
    JOB_STATES.map((state) =>
      collection.where('state', '==', state).count().get()
    )
  );

  snapshots.forEach((snapshot, index) => {
    const state = JOB_STATES[index];
    const count = Number(snapshot.data().count ?? 0);
    counts[state] = Number.isFinite(count) && count >= 0
      ? Math.trunc(count)
      : 0;
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
    const state = normalizeState(job.state);

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

function resolveOperationalState(
  provider: GoogleVideoTranscoderProbeResult
): VideoProcessingOperationalState {
  if (provider.status === 'READY') {
    return 'READY';
  }

  if (provider.status === 'EMULATOR_SKIPPED') {
    return 'EMULATOR';
  }

  return 'DEGRADED';
}

export const getVideoProcessingOperationalStatus = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<AdminVideoProcessingStatusResponse> => {
    const adminUid = assertAdmin(request.auth);
    const checkedAt = Date.now();

    try {
      const [provider, counts] = await Promise.all([
        probeGoogleVideoTranscoder(),
        readJobCounts(),
      ]);
      const activeTotal = ACTIVE_JOB_STATES.reduce(
        (total, state) => total + counts[state],
        0
      );
      const activeSample = await readActiveSample(checkedAt, counts);
      const state = resolveOperationalState(provider);

      if (state === 'DEGRADED') {
        logger.warn('[videoProcessingStatus] Provedor indisponível.', {
          adminUid,
          errorCode: provider.errorCode,
          location: provider.location,
          activeTotal,
        });
      }

      return {
        state,
        checkedAt,
        provider,
        queue: {
          counts,
          activeTotal,
          ...activeSample,
        },
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

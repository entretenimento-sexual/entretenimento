import { createHash } from 'node:crypto';

import type {
  VideoProcessingJob,
  VideoProcessingJobState,
} from './video-processing-job';

export type VideoProcessingDispatchMode =
  | 'SUBMIT'
  | 'RECOVER_SUBMISSION'
  | 'RECONCILE'
  | 'CANCEL';

export interface VideoProcessingDispatch {
  dispatchId: string;
  taskId: string;
  jobId: string;
  processingVersion: string;
  mode: VideoProcessingDispatchMode;
  dueAt: number;
  scheduleAt: number;
}

export interface VideoProcessingDispatchPayload {
  dispatchId: string;
  jobId: string;
  processingVersion: string;
  mode: VideoProcessingDispatchMode;
  dueAt: number;
}

const RECONCILIATION_INTERVAL_MS = 60_000;
const SUBMISSION_RECOVERY_FALLBACK_MS = 5 * 60_000;
const MAX_SCHEDULE_HORIZON_MS = 30 * 24 * 60 * 60_000;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeTimestamp(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function normalizeState(value: unknown): VideoProcessingJobState | null {
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

  return null;
}

function dispatchModeForState(
  state: VideoProcessingJobState
): VideoProcessingDispatchMode | null {
  if (state === 'QUEUED') {
    return 'SUBMIT';
  }

  if (state === 'SUBMITTING') {
    return 'RECOVER_SUBMISSION';
  }

  if (state === 'PROCESSING') {
    return 'RECONCILE';
  }

  if (state === 'CANCEL_REQUESTED') {
    return 'CANCEL';
  }

  return null;
}

function dueAtForJob(
  job: Pick<
    VideoProcessingJob,
    | 'state'
    | 'nextAttemptAt'
    | 'leaseUntil'
    | 'updatedAt'
    | 'cancelRequestedAt'
    | 'createdAt'
  >,
  mode: VideoProcessingDispatchMode,
  now: number
): number {
  if (mode === 'SUBMIT') {
    return normalizeTimestamp(job.nextAttemptAt) || now;
  }

  if (mode === 'RECOVER_SUBMISSION') {
    return normalizeTimestamp(job.leaseUntil) ||
      Math.max(
        now,
        (normalizeTimestamp(job.updatedAt) || now) +
          SUBMISSION_RECOVERY_FALLBACK_MS
      );
  }

  if (mode === 'RECONCILE') {
    return Math.max(
      now,
      (normalizeTimestamp(job.updatedAt) || now) +
        RECONCILIATION_INTERVAL_MS
    );
  }

  return normalizeTimestamp(job.cancelRequestedAt) ||
    normalizeTimestamp(job.updatedAt) ||
    normalizeTimestamp(job.createdAt) ||
    now;
}

function scheduleAtForDueAt(dueAt: number, now: number): number {
  return Math.max(
    now,
    Math.min(dueAt, now + MAX_SCHEDULE_HORIZON_MS)
  );
}

function buildDispatchId(
  jobId: string,
  processingVersion: string,
  mode: VideoProcessingDispatchMode,
  dueAt: number
): string {
  const digest = createHash('sha256')
    .update(`${jobId}:${processingVersion}:${mode}:${dueAt}`)
    .digest('hex');

  return `video-processing-${digest}`;
}

export function resolveVideoProcessingDispatch(
  jobIdValue: unknown,
  jobValue: Partial<VideoProcessingJob> | null | undefined,
  nowValue = Date.now()
): VideoProcessingDispatch | null {
  const jobId = cleanId(jobIdValue);
  const processingVersion = cleanId(jobValue?.processingVersion);
  const state = normalizeState(jobValue?.state);
  const now = normalizeTimestamp(nowValue) || Date.now();

  if (!jobId || !processingVersion || !state) {
    return null;
  }

  const mode = dispatchModeForState(state);

  if (!mode) {
    return null;
  }

  const dueAt = dueAtForJob(
    {
      state,
      nextAttemptAt: jobValue?.nextAttemptAt ?? 0,
      leaseUntil: jobValue?.leaseUntil ?? null,
      updatedAt: jobValue?.updatedAt ?? 0,
      cancelRequestedAt: jobValue?.cancelRequestedAt ?? null,
      createdAt: jobValue?.createdAt ?? 0,
    },
    mode,
    now
  );
  const dispatchId = buildDispatchId(
    jobId,
    processingVersion,
    mode,
    dueAt
  );

  return {
    dispatchId,
    taskId: dispatchId,
    jobId,
    processingVersion,
    mode,
    dueAt,
    scheduleAt: scheduleAtForDueAt(dueAt, now),
  };
}

export function buildVideoProcessingDispatchPayload(
  dispatch: VideoProcessingDispatch
): VideoProcessingDispatchPayload {
  return {
    dispatchId: dispatch.dispatchId,
    jobId: dispatch.jobId,
    processingVersion: dispatch.processingVersion,
    mode: dispatch.mode,
    dueAt: dispatch.dueAt,
  };
}

export const VIDEO_PROCESSING_RECONCILIATION_INTERVAL_MS =
  RECONCILIATION_INTERVAL_MS;

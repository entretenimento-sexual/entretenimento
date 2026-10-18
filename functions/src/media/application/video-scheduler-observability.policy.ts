/**
 * Identifier-free, bounded execution evidence. A recent successful invocation
 * proves only that invocation, never the Cloud Scheduler's complete history.
 */
export const VIDEO_SCHEDULER_COLLECTION = 'media_video_scheduler_execution';
export const VIDEO_SCHEDULERS = [
  'submitQueuedVideoProcessing',
  'reconcileVideoProcessing',
  'cleanupCancelledVideoProcessing',
] as const;
export type VideoSchedulerName = typeof VIDEO_SCHEDULERS[number];
export type VideoSchedulerOutcome = 'OK' | 'ATTENTION' | 'FAILED';
export type VideoSchedulerHealth = 'OPERATIONAL' | 'DEGRADED' | 'FAILED' | 'UNVERIFIED';
export type SchedulerExecutionHealth = 'EXECUTED' | 'FAILED' | 'UNVERIFIED';
export type SchedulerJobHealth = 'NO_ALERTS_OBSERVED' | 'ATTENTION' | 'UNVERIFIED';

export const VIDEO_SCHEDULER_INTERVAL_MS: Record<VideoSchedulerName, number> = {
  submitQueuedVideoProcessing: 5 * 60_000,
  reconcileVideoProcessing: 5 * 60_000,
  cleanupCancelledVideoProcessing: 30 * 60_000,
};

const METRIC_KEYS = [
  'selected', 'attempted', 'claimed', 'skipped', 'taskRejected',
  'invalid', 'retryScheduled', 'unconfirmed', 'replaced', 'completed',
  'reviewRequired', 'batchLimitReached', 'recoveredSubmissionSelected',
  'recoveredSubmissionClaimed', 'recoveredSubmissionRejected',
  'terminalSelected', 'terminalCompleted', 'terminalRetryScheduled',
  'terminalReviewRequired', 'terminalClaimSkipped',
  'submissionConfirmed', 'submissionUnconfirmed', 'submissionRetryScheduled',
  'submissionFailed', 'submissionDeferred', 'submissionReplaced',
  'recoveryConfirmed', 'recoveryUnconfirmed', 'recoveryPollErrors',
  'recoveryReplaced', 'providerPollErrors', 'providerReviewRequired',
  'providerNonterminal', 'providerSucceededObserved',
  'providerFailedObserved', 'processingReplaced',
  'providerSucceededApplied', 'providerFailedApplied',
  'providerTerminalCancelRequested', 'providerNonterminalApplied',
  'submissionCancelRequested', 'recoveryCancelRequested',
  'processingSkipped',
] as const;

export type VideoSchedulerMetrics = Partial<Record<typeof METRIC_KEYS[number], number | boolean>>;

export interface VideoSchedulerCycleRecord {
  evidenceVersion: 3;
  scheduler: VideoSchedulerName;
  cycleId: string;
  startedAt: number;
  finishedAt: number;
  outcome: VideoSchedulerOutcome;
  phase: string;
  durationMs: number;
  metrics: VideoSchedulerMetrics;
}

export function safeVideoSchedulerMetrics(input: VideoSchedulerMetrics): VideoSchedulerMetrics {
  const metrics: VideoSchedulerMetrics = {};
  for (const key of METRIC_KEYS) {
    const value = input[key];
    if (key === 'batchLimitReached') {
      if (typeof value === 'boolean') metrics[key] = value;
    } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      // Counts are aggregates, never user IDs or sizes from source assets.
      metrics[key] = Math.min(value, 1_000_000);
    }
  }
  return metrics;
}

export function videoSchedulerRecord(
  scheduler: VideoSchedulerName, cycleId: string, startedAt: number,
  finishedAt: number, outcome: VideoSchedulerOutcome,
  phase: string, metrics: VideoSchedulerMetrics
): VideoSchedulerCycleRecord {
  return {
    evidenceVersion: 3,
    scheduler, cycleId, startedAt, finishedAt, outcome,
    phase: /^[A-Z_]{1,32}$/.test(phase) ? phase : 'UNKNOWN',
    durationMs: Math.max(0, finishedAt - startedAt),
    metrics: safeVideoSchedulerMetrics(metrics),
  };
}

export interface VideoSchedulerDiagnostic {
  scheduler: VideoSchedulerName;
  intervalMinutes: number;
  health: VideoSchedulerHealth;
  executionHealth: SchedulerExecutionHealth;
  jobsHealth: SchedulerJobHealth;
  lastOutcome: VideoSchedulerOutcome | null;
  lastFinishedAt: number | null;
  ageMs: number | null;
  durationMs: number | null;
  metrics: VideoSchedulerMetrics;
}

/**
 * 5-minute cycles have a 25-minute evidence horizon; 30-minute cycles 100.
 * A stale record is UNVERIFIED even if its last outcome was OK.
 */
export function diagnoseVideoScheduler(
  scheduler: VideoSchedulerName, data: unknown, now: number
): VideoSchedulerDiagnostic {
  const intervalMinutes = VIDEO_SCHEDULER_INTERVAL_MS[scheduler] / 60_000;
  const base: VideoSchedulerDiagnostic = {
    scheduler, intervalMinutes, health: 'UNVERIFIED',
    executionHealth: 'UNVERIFIED', jobsHealth: 'UNVERIFIED', lastOutcome: null,
    lastFinishedAt: null, ageMs: null, durationMs: null, metrics: {},
  };
  if (!data || typeof data !== 'object') return base;
  const value = data as Partial<VideoSchedulerCycleRecord>;
  const finishedAt = value.finishedAt;
  if (value.scheduler !== scheduler ||
      !Number.isSafeInteger(finishedAt) ||
      typeof finishedAt !== 'number' || finishedAt <= 0 ||
      finishedAt > now ||
      (value.outcome !== 'OK' && value.outcome !== 'ATTENTION' && value.outcome !== 'FAILED')) {
    return base;
  }
  const ageMs = now - finishedAt;
  const horizonMs = intervalMinutes === 5 ? 25 * 60_000 : 100 * 60_000;
  return {
    ...base,
    health: ageMs > horizonMs ? 'UNVERIFIED'
      : value.outcome === 'OK' ? 'OPERATIONAL'
        : value.outcome === 'ATTENTION' ? 'DEGRADED' : 'FAILED',
    executionHealth: ageMs > horizonMs ? 'UNVERIFIED'
      : value.outcome === 'FAILED' ? 'FAILED' : 'EXECUTED',
    jobsHealth: ageMs > horizonMs || value.evidenceVersion !== 3 ||
      value.outcome === 'FAILED' ? 'UNVERIFIED'
      : value.outcome === 'ATTENTION' ? 'ATTENTION' : 'NO_ALERTS_OBSERVED',
    lastOutcome: value.outcome,
    lastFinishedAt: finishedAt,
    ageMs,
    durationMs: typeof value.durationMs === 'number' &&
      Number.isSafeInteger(value.durationMs) && value.durationMs >= 0
      ? value.durationMs : null,
    metrics: safeVideoSchedulerMetrics(value.metrics ?? {}),
  };
}

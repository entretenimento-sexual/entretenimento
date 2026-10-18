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
export type VideoSchedulerEvidenceConfidence =
  'RECENT' | 'STALE' | 'MISSING' | 'INVALID' | 'READ_UNAVAILABLE';
export type VideoSchedulerHistoryCoverage = 'BEST_EFFORT' | 'LEGACY_OR_UNKNOWN';
export const VIDEO_SCHEDULER_INCIDENT_LIMIT = 5;
export const VIDEO_SCHEDULER_INCIDENT_WINDOW_MS = 24 * 60 * 60_000;

export interface VideoSchedulerIncident {
  cycleId: string;
  startedAt: number;
  finishedAt: number;
  outcome: 'ATTENTION' | 'FAILED';
  phase: string;
}

export interface VideoSchedulerStoredEvidence extends VideoSchedulerCycleRecord {
  historyVersion: 1;
  recentIncidents: VideoSchedulerIncident[];
}

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
  evidenceConfidence: VideoSchedulerEvidenceConfidence;
  historyCoverage: VideoSchedulerHistoryCoverage;
  recentIncident: Omit<VideoSchedulerIncident, 'cycleId'> | null;
  recentIncidentCount: number;
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
    evidenceConfidence: 'MISSING', historyCoverage: 'LEGACY_OR_UNKNOWN',
    recentIncident: null, recentIncidentCount: 0,
  };
  if (!data || typeof data !== 'object') return base;
  const value = data as Partial<VideoSchedulerStoredEvidence>;
  const finishedAt = value.finishedAt;
  if (value.scheduler !== scheduler ||
      !Number.isSafeInteger(finishedAt) ||
      typeof finishedAt !== 'number' || finishedAt <= 0 ||
      finishedAt > now ||
      (value.outcome !== 'OK' && value.outcome !== 'ATTENTION' && value.outcome !== 'FAILED')) {
    return { ...base, evidenceConfidence: 'INVALID' };
  }
  const incidents = collectVideoSchedulerIncidents(value, value as VideoSchedulerCycleRecord)
    .filter(item => item.finishedAt <= now &&
      item.finishedAt >= now - VIDEO_SCHEDULER_INCIDENT_WINDOW_MS);
  const latestIncident = incidents[0];
  const ageMs = now - finishedAt;
  const horizonMs = intervalMinutes === 5 ? 25 * 60_000 : 100 * 60_000;
  return {
    ...base,
    evidenceConfidence: ageMs > horizonMs ? 'STALE' : 'RECENT',
    historyCoverage: value.historyVersion === 1
      ? 'BEST_EFFORT' : 'LEGACY_OR_UNKNOWN',
    recentIncident: latestIncident ? {
      startedAt: latestIncident.startedAt,
      finishedAt: latestIncident.finishedAt,
      outcome: latestIncident.outcome,
      phase: latestIncident.phase,
    } : null,
    recentIncidentCount: incidents.length,
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


/** Timestamp ties resolve independently of invocation arrival order. */
export function compareVideoSchedulerCycles(
  left: Pick<VideoSchedulerCycleRecord, 'finishedAt' | 'startedAt' | 'cycleId'>,
  right: Pick<VideoSchedulerCycleRecord, 'finishedAt' | 'startedAt' | 'cycleId'>
): number {
  return left.finishedAt - right.finishedAt ||
    left.startedAt - right.startedAt ||
    (left.cycleId < right.cycleId ? -1 : left.cycleId > right.cycleId ? 1 : 0);
}

function validIncident(value: unknown): value is VideoSchedulerIncident {
  if (!value || typeof value !== 'object') return false;
  const incident = value as Partial<VideoSchedulerIncident>;
  return typeof incident.cycleId === 'string' &&
    /^[A-Za-z0-9-]{1,128}$/.test(incident.cycleId) &&
    typeof incident.startedAt === 'number' &&
    Number.isSafeInteger(incident.startedAt) && incident.startedAt >= 0 &&
    typeof incident.finishedAt === 'number' &&
    Number.isSafeInteger(incident.finishedAt) &&
    incident.finishedAt >= incident.startedAt &&
    (incident.outcome === 'FAILED' || incident.outcome === 'ATTENTION') &&
    typeof incident.phase === 'string' &&
    /^[A-Z_]{1,32}$/.test(incident.phase);
}

function collectVideoSchedulerIncidents(
  previous: Partial<VideoSchedulerStoredEvidence> | null,
  incoming: VideoSchedulerCycleRecord
): VideoSchedulerIncident[] {
  const collected: VideoSchedulerIncident[] = [];
  if (previous && Array.isArray(previous.recentIncidents)) {
    for (const item of previous.recentIncidents.slice(0, VIDEO_SCHEDULER_INCIDENT_LIMIT)) {
      if (validIncident(item)) collected.push({
        cycleId: item.cycleId, startedAt: item.startedAt,
        finishedAt: item.finishedAt, outcome: item.outcome, phase: item.phase,
      });
    }
  }
  // Include pre-migration last incident and late incoming incident.
  for (const cycle of [previous, incoming]) {
    if (validIncident(cycle)) collected.push({
      cycleId: cycle.cycleId, startedAt: cycle.startedAt,
      finishedAt: cycle.finishedAt, outcome: cycle.outcome, phase: cycle.phase,
    });
  }
  const anchor = Math.max(incoming.finishedAt, previous?.finishedAt ?? 0);
  const unique = new Map<string, VideoSchedulerIncident>();
  for (const incident of collected) {
    if (incident.finishedAt < anchor - VIDEO_SCHEDULER_INCIDENT_WINDOW_MS ||
      incident.finishedAt > anchor) continue;
    const existing = unique.get(incident.cycleId);
    if (!existing || compareVideoSchedulerCycles(incident, existing) > 0) {
      unique.set(incident.cycleId, incident);
    }
  }
  return [...unique.values()]
    .sort((a, b) => compareVideoSchedulerCycles(b, a))
    .slice(0, VIDEO_SCHEDULER_INCIDENT_LIMIT);
}

/**
 * Pure bounded merge for one transactional document per scheduler.
 * Late failures can add evidence; late OK cycles never replace the latest.
 */
export function mergeVideoSchedulerEvidence(
  previous: unknown, incoming: VideoSchedulerCycleRecord
): VideoSchedulerStoredEvidence | null {
  const stored = previous && typeof previous === 'object'
    ? previous as Partial<VideoSchedulerStoredEvidence> : null;
  const validPrevious = stored?.scheduler === incoming.scheduler &&
    typeof stored.cycleId === 'string' &&
    typeof stored.startedAt === 'number' &&
    Number.isSafeInteger(stored.startedAt) &&
    typeof stored.finishedAt === 'number' &&
    Number.isSafeInteger(stored.finishedAt) &&
    stored.startedAt <= stored.finishedAt &&
    (stored.outcome === 'OK' || stored.outcome === 'ATTENTION' ||
      stored.outcome === 'FAILED')
    ? stored as VideoSchedulerStoredEvidence : null;
  const newest = !validPrevious ||
    compareVideoSchedulerCycles(incoming, validPrevious) > 0;
  const incidents = collectVideoSchedulerIncidents(validPrevious, incoming);
  if (!newest && validPrevious?.historyVersion === 1 &&
    JSON.stringify(validPrevious.recentIncidents ?? []) === JSON.stringify(incidents)) {
    return null;
  }
  return {
    ...(newest ? incoming : validPrevious as VideoSchedulerCycleRecord),
    historyVersion: 1,
    recentIncidents: incidents,
  };
}

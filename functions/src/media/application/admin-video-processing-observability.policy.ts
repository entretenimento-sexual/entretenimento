export type VideoProcessingOperationalState =
  | 'READY'
  | 'DEGRADED'
  | 'EMULATOR';

export type VideoProcessingAlertSeverity =
  | 'INFO'
  | 'WARNING'
  | 'CRITICAL';

export type VideoProcessingAlertCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'STALE_JOBS'
  | 'DISPATCH_BACKLOG'
  | 'DISPATCH_FAILURES'
  | 'RECENT_DEAD_LETTERS'
  | 'ACTIVE_SAMPLE_CAPPED';

export type VideoProcessingDispatchState =
  | 'ENQUEUEING'
  | 'ENQUEUED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EMULATOR_SKIPPED';

export interface VideoProcessingAlert {
  code: VideoProcessingAlertCode;
  severity: VideoProcessingAlertSeverity;
  title: string;
  message: string;
  value: number | null;
}

export interface VideoProcessingDispatchRecord {
  state: VideoProcessingDispatchState;
  mode: string;
  createdAt: number;
  updatedAt: number;
  enqueuedAt: number | null;
  completedAt: number | null;
  taskAlreadyExisted: boolean;
}

export interface VideoProcessingDispatchCounts {
  ENQUEUEING: number;
  ENQUEUED: number;
  COMPLETED: number;
  FAILED: number;
  EMULATOR_SKIPPED: number;
}

export interface VideoProcessingDispatchMetrics {
  counts: VideoProcessingDispatchCounts;
  pendingTotal: number;
  oldestPendingAgeMs: number | null;
  recentWindowMs: number;
  recentTotal: number;
  completedRecent: number;
  failedRecent: number;
  duplicateRecent: number;
  latencySampleSize: number;
  averageLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  sampleCapped: boolean;
}

export interface VideoProcessingDeadLetterRecord {
  errorCode: string | null;
  failedAt: number;
}

export interface VideoProcessingFailureCodeSummary {
  code: string;
  count: number;
  lastSeenAt: number;
}

export interface VideoProcessingHealthInput {
  providerStatus: 'READY' | 'EMULATOR_SKIPPED' | 'UNAVAILABLE';
  staleSampledJobs: number;
  activeSampleCapped: boolean;
  dispatch: VideoProcessingDispatchMetrics;
  recentDeadLetters: number;
}

export interface VideoProcessingHealthResult {
  state: VideoProcessingOperationalState;
  alerts: VideoProcessingAlert[];
}

export const VIDEO_PROCESSING_OBSERVABILITY_WINDOW_MS =
  24 * 60 * 60 * 1000;
export const VIDEO_PROCESSING_DISPATCH_SAMPLE_LIMIT = 200;
export const VIDEO_PROCESSING_DEAD_LETTER_SAMPLE_LIMIT = 100;

const DISPATCH_BACKLOG_WARNING_MS = 5 * 60 * 1000;
const DISPATCH_BACKLOG_CRITICAL_MS = 15 * 60 * 1000;

const ALERT_SEVERITY_ORDER: Record<VideoProcessingAlertSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function normalizeOptionalNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function normalizeDispatchState(
  value: unknown
): VideoProcessingDispatchState | null {
  const state = String(value ?? '').trim().toUpperCase();

  if (
    state === 'ENQUEUEING' ||
    state === 'ENQUEUED' ||
    state === 'COMPLETED' ||
    state === 'FAILED' ||
    state === 'EMULATOR_SKIPPED'
  ) {
    return state;
  }

  return null;
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

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const boundedPercentile = Math.max(0, Math.min(1, percentileValue));
  const index = Math.ceil(boundedPercentile * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? null;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return Math.trunc(
    values.reduce((total, value) => total + value, 0) / values.length
  );
}

export function buildVideoProcessingDispatchMetrics(command: {
  records: VideoProcessingDispatchRecord[];
  counts: Partial<VideoProcessingDispatchCounts>;
  checkedAt: number;
  recentWindowMs?: number;
  sampleLimit?: number;
}): VideoProcessingDispatchMetrics {
  const checkedAt = normalizeNonNegativeInteger(command.checkedAt);
  const recentWindowMs = Math.max(
    60_000,
    normalizeNonNegativeInteger(command.recentWindowMs) ||
      VIDEO_PROCESSING_OBSERVABILITY_WINDOW_MS
  );
  const sampleLimit = Math.max(
    1,
    normalizeNonNegativeInteger(command.sampleLimit) ||
      VIDEO_PROCESSING_DISPATCH_SAMPLE_LIMIT
  );
  const counts = emptyDispatchCounts();

  Object.keys(counts).forEach((state) => {
    counts[state as VideoProcessingDispatchState] = normalizeNonNegativeInteger(
      command.counts[state as VideoProcessingDispatchState]
    );
  });

  const recentThreshold = Math.max(0, checkedAt - recentWindowMs);
  const latencies: number[] = [];
  let recentTotal = 0;
  let completedRecent = 0;
  let failedRecent = 0;
  let duplicateRecent = 0;
  let oldestPendingAgeMs: number | null = null;

  for (const record of command.records) {
    const state = normalizeDispatchState(record.state);

    if (!state) {
      continue;
    }

    const createdAt = normalizeNonNegativeInteger(record.createdAt);
    const updatedAt = normalizeNonNegativeInteger(record.updatedAt) || createdAt;
    const completedAt = normalizeOptionalNonNegativeInteger(record.completedAt);
    const referenceAt = completedAt ?? updatedAt;

    if (referenceAt >= recentThreshold) {
      recentTotal += 1;

      if (state === 'COMPLETED') {
        completedRecent += 1;
      }

      if (state === 'FAILED') {
        failedRecent += 1;
      }

      if (record.taskAlreadyExisted === true) {
        duplicateRecent += 1;
      }
    }

    if (state === 'ENQUEUEING' || state === 'ENQUEUED') {
      const ageMs = Math.max(0, checkedAt - (createdAt || updatedAt));
      oldestPendingAgeMs = oldestPendingAgeMs === null
        ? ageMs
        : Math.max(oldestPendingAgeMs, ageMs);
    }

    if (state === 'COMPLETED' && createdAt > 0 && completedAt !== null) {
      latencies.push(Math.max(0, completedAt - createdAt));
    }
  }

  return {
    counts,
    pendingTotal: counts.ENQUEUEING + counts.ENQUEUED,
    oldestPendingAgeMs,
    recentWindowMs,
    recentTotal,
    completedRecent,
    failedRecent,
    duplicateRecent,
    latencySampleSize: latencies.length,
    averageLatencyMs: average(latencies),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    sampleCapped: command.records.length >= sampleLimit,
  };
}

export function summarizeVideoProcessingFailureCodes(
  records: VideoProcessingDeadLetterRecord[],
  limit = 6
): VideoProcessingFailureCodeSummary[] {
  const summaries = new Map<string, VideoProcessingFailureCodeSummary>();

  for (const record of records) {
    const code = String(record.errorCode ?? '').trim().slice(0, 120) ||
      'UNCLASSIFIED_PROCESSING_FAILURE';
    const failedAt = normalizeNonNegativeInteger(record.failedAt);
    const current = summaries.get(code);

    summaries.set(code, {
      code,
      count: (current?.count ?? 0) + 1,
      lastSeenAt: Math.max(current?.lastSeenAt ?? 0, failedAt),
    });
  }

  return [...summaries.values()]
    .sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return right.lastSeenAt - left.lastSeenAt;
    })
    .slice(0, Math.max(1, Math.min(20, Math.trunc(limit))));
}

function createAlert(
  code: VideoProcessingAlertCode,
  severity: VideoProcessingAlertSeverity,
  title: string,
  message: string,
  value: number | null
): VideoProcessingAlert {
  return { code, severity, title, message, value };
}

export function resolveVideoProcessingHealth(
  input: VideoProcessingHealthInput
): VideoProcessingHealthResult {
  const alerts: VideoProcessingAlert[] = [];

  if (input.providerStatus === 'UNAVAILABLE') {
    alerts.push(createAlert(
      'PROVIDER_UNAVAILABLE',
      'CRITICAL',
      'Transcoder indisponível',
      'A API, a região ou as permissões do provedor precisam ser revisadas.',
      null
    ));
  }

  const staleJobs = normalizeNonNegativeInteger(input.staleSampledJobs);

  if (staleJobs > 0) {
    alerts.push(createAlert(
      'STALE_JOBS',
      staleJobs >= 5 ? 'CRITICAL' : 'WARNING',
      'Jobs possivelmente atrasados',
      `${staleJobs} job(s) ultrapassaram a janela esperada do estado atual.`,
      staleJobs
    ));
  }

  const oldestPendingAgeMs = input.dispatch.oldestPendingAgeMs ?? 0;

  if (oldestPendingAgeMs >= DISPATCH_BACKLOG_WARNING_MS) {
    alerts.push(createAlert(
      'DISPATCH_BACKLOG',
      oldestPendingAgeMs >= DISPATCH_BACKLOG_CRITICAL_MS
        ? 'CRITICAL'
        : 'WARNING',
      'Backlog no Cloud Tasks',
      'Há despacho aguardando execução além da janela operacional esperada.',
      oldestPendingAgeMs
    ));
  }

  const unresolvedDispatchFailures = normalizeNonNegativeInteger(
    input.dispatch.counts.FAILED
  );

  if (unresolvedDispatchFailures > 0) {
    alerts.push(createAlert(
      'DISPATCH_FAILURES',
      'CRITICAL',
      'Falhas de despacho pendentes',
      `${unresolvedDispatchFailures} despacho(s) não foram concluídos.`,
      unresolvedDispatchFailures
    ));
  }

  const recentDeadLetters = normalizeNonNegativeInteger(
    input.recentDeadLetters
  );

  if (recentDeadLetters > 0) {
    alerts.push(createAlert(
      'RECENT_DEAD_LETTERS',
      recentDeadLetters >= 5 ? 'CRITICAL' : 'WARNING',
      'Falhas terminais recentes',
      `${recentDeadLetters} job(s) chegaram à DLQ nas últimas 24 horas.`,
      recentDeadLetters
    ));
  }

  if (input.activeSampleCapped) {
    alerts.push(createAlert(
      'ACTIVE_SAMPLE_CAPPED',
      'INFO',
      'Amostra ativa limitada',
      'A idade e o atraso foram calculados sobre uma amostra limitada de jobs.',
      null
    ));
  }

  alerts.sort((left, right) =>
    ALERT_SEVERITY_ORDER[left.severity] -
    ALERT_SEVERITY_ORDER[right.severity]
  );

  if (input.providerStatus === 'EMULATOR_SKIPPED') {
    return { state: 'EMULATOR', alerts };
  }

  return {
    state: alerts.some((alert) => alert.severity !== 'INFO')
      ? 'DEGRADED'
      : 'READY',
    alerts,
  };
}

// Offline, bounded correlation of existing Media scheduler Cloud Logging exports.
// Diagnostic only: no network access, credentials, job control or user identifiers.
const SCHEDULERS = [
  ['submitQueuedVideoProcessing', 5],
  ['reconcileVideoProcessing', 5],
  ['cleanupCancelledVideoProcessing', 30],
];
const ALLOWED = new Map(SCHEDULERS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERIC = new Map([
  ['VIDEO_MEDIA_SCHEDULER_STARTED', 'STARTED'],
  ['VIDEO_MEDIA_SCHEDULER_FINISHED', 'FINISHED'],
  ['VIDEO_MEDIA_SCHEDULER_FAILED', 'FAILED'],
]);
const CANCELLATION = new Map([
  ['VIDEO_CANCELLATION_CYCLE_STARTED', 'STARTED'],
  ['VIDEO_CANCELLATION_CYCLE_FINISHED', 'FINISHED'],
  ['VIDEO_CANCELLATION_CYCLE_FAILED', 'FAILED'],
]);
const WARNING = 'VIDEO_MEDIA_SCHEDULER_EVIDENCE_UNAVAILABLE';

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : null;
}
function iso(value) {
  return value === null ? null : new Date(value).toISOString();
}
function integer(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= 0 ? Math.min(1_000_000, value) : null;
}
function completion(payload, at, legacy) {
  const candidate = legacy ? payload.status : payload.outcome;
  const metrics = !legacy && payload.metrics && typeof payload.metrics === 'object'
    ? payload.metrics : payload;
  return {
    at: iso(at),
    outcome: candidate === 'OK' || candidate === 'ATTENTION'
      ? candidate : 'UNKNOWN',
    selected: integer(metrics.selected),
    taskRejected: integer(metrics.taskRejected),
  };
}
function empty(scheduler, intervalMinutes) {
  return {
    scheduler, intervalMinutes, classification: 'INSUFFICIENT_EVIDENCE',
    schedulerHealth: 'NOT_VERIFIED',
    observedCycles: 0, finishedCycles: 0, failedCycles: 0,
    startedWithoutTerminal: 0, terminalWithoutStart: 0,
    conflictingTerminals: 0, duplicateEvents: 0, overlappingCycles: 0,
    suspectedGaps: 0, longestStartGapMs: null,
    telemetryWriteUnconfirmed: 0, correlatedTelemetryWarnings: 0,
    uncorrelatedTelemetryWarnings: 0,
    latestStartedAt: null, latestTerminalAt: null, latestCompletion: null,
  };
}

/**
 * A missing event is not proof that Cloud Scheduler skipped a trigger.
 * FAILED_CONFIRMED means a failed invocation log, never a provider/job verdict.
 * Suspected gaps require two observed starts; exported logs cannot verify the
 * schedule's actual delivery history or the completeness of the export.
 */
export function summarizeExportedVideoSchedulerLogs(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length > 2000) {
    throw new Error('Exportação inválida ou excede 2.000 entradas.');
  }
  const exportLimit = options.exportLimit ?? 1500;
  if (!Number.isSafeInteger(exportLimit) || exportLimit < 1 ||
      exportLimit > 2000) {
    throw new Error('Limite de exportação inválido.');
  }
  const collected = new Map(SCHEDULERS.map(([name, minutes]) =>
    [name, { report: empty(name, minutes), cycles: new Map(),
      warnings: [], warningKeys: new Set() }]
  ));
  let acceptedEvents = 0;
  let ignoredEvents = 0;
  for (const entry of entries) {
    const payload = entry && typeof entry === 'object' ? entry.jsonPayload : null;
    const event = payload?.event;
    const at = timestamp(entry?.timestamp);
    const legacy = CANCELLATION.has(event);
    const kind = legacy ? CANCELLATION.get(event) : GENERIC.get(event);
    const isWarning = event === WARNING;
    const scheduler = legacy ? 'cleanupCancelledVideoProcessing' : payload?.scheduler;
    if ((!kind && !isWarning) || !ALLOWED.has(scheduler) || at === null ||
        !payload || typeof payload !== 'object') {
      ignoredEvents++;
      continue;
    }
    const id = payload.cycleId;
    if (!isWarning && (typeof id !== 'string' || !UUID.test(id))) {
      ignoredEvents++;
      continue;
    }
    acceptedEvents++;
    const bucket = collected.get(scheduler);
    if (isWarning) {
      // Legacy warnings did not carry a cycleId and cannot be correlated exactly.
      const validId = typeof id === 'string' && UUID.test(id) ? id : null;
      const key = String(validId) + ':' + at;
      if (!bucket.warningKeys.has(key)) {
        bucket.warningKeys.add(key);
        bucket.warnings.push(validId);
      } else {
        bucket.report.duplicateEvents++;
      }
      continue;
    }
    const cycle = bucket.cycles.get(id) ?? {
      startedAt: null, finishedAt: null, failedAt: null, latestCompletion: null,
    };
    const property = kind === 'STARTED' ? 'startedAt'
      : kind === 'FINISHED' ? 'finishedAt' : 'failedAt';
    if (cycle[property] !== null) {
      bucket.report.duplicateEvents++;
    }
    // Use earliest occurrence for each kind, independent of export ordering.
    if (cycle[property] === null || at < cycle[property]) {
      cycle[property] = at;
      if (kind === 'FINISHED') cycle.latestCompletion = completion(payload, at, legacy);
    }
    bucket.cycles.set(id, cycle);
  }

  for (const [, bucket] of collected) {
    const { report, cycles, warnings } = bucket;
    report.observedCycles = cycles.size;
    const starts = [];
    const windows = [];
    let latestCompletionAt = null;
    for (const cycle of cycles.values()) {
      const endedAt = cycle.finishedAt === null ? cycle.failedAt
        : cycle.failedAt === null ? cycle.finishedAt
          : Math.max(cycle.finishedAt, cycle.failedAt);
      if (cycle.startedAt !== null) {
        starts.push(cycle.startedAt);
        if (endedAt !== null) windows.push([cycle.startedAt, endedAt]);
        if (report.latestStartedAt === null ||
            cycle.startedAt > Date.parse(report.latestStartedAt)) {
          report.latestStartedAt = iso(cycle.startedAt);
        }
        if (endedAt === null) report.startedWithoutTerminal++;
      } else if (endedAt !== null) {
        report.terminalWithoutStart++;
      }
      if (cycle.finishedAt !== null) {
        report.finishedCycles++;
        if (latestCompletionAt === null || cycle.finishedAt > latestCompletionAt) {
          latestCompletionAt = cycle.finishedAt;
          report.latestCompletion = cycle.latestCompletion;
        }
      }
      if (cycle.failedAt !== null) report.failedCycles++;
      if (cycle.failedAt !== null && cycle.finishedAt !== null) {
        report.conflictingTerminals++;
      }
      if (endedAt !== null &&
          (report.latestTerminalAt === null ||
            endedAt > Date.parse(report.latestTerminalAt))) {
        report.latestTerminalAt = iso(endedAt);
      }
    }
    starts.sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      if (report.longestStartGapMs === null || gap > report.longestStartGapMs) {
        report.longestStartGapMs = gap;
      }
      if (gap > report.intervalMinutes * 3 * 60_000) report.suspectedGaps++;
    }
    windows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 1; i < windows.length; i++) {
      if (windows[i][0] < windows[i - 1][1]) report.overlappingCycles++;
    }
    report.telemetryWriteUnconfirmed = warnings.length;
    report.correlatedTelemetryWarnings = warnings.filter(id =>
      id !== null && cycles.has(id)
    ).length;
    report.uncorrelatedTelemetryWarnings = warnings.length -
      report.correlatedTelemetryWarnings;
    report.classification = report.failedCycles > 0 ? 'FAILED_CONFIRMED'
      : report.suspectedGaps > 0 ? 'SUSPECTED_GAP'
        : report.finishedCycles > 0 ? 'EXECUTION_OBSERVED'
          : 'INSUFFICIENT_EVIDENCE';
  }
  const schedulers = [...collected.values()].map(bucket => bucket.report);
  return {
    evidence: 'EXPORTED_LOGS_ONLY',
    schedulerHealth: 'NOT_VERIFIED',
    exportedEntries: entries.length,
    acceptedEvents, ignoredEvents,
    sampleMayBeTruncated: entries.length >= exportLimit,
    schedulersWithoutEvents: schedulers.filter(s =>
      s.observedCycles === 0 && s.telemetryWriteUnconfirmed === 0
    ).length,
    schedulers,
  };
}

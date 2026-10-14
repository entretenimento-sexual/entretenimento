// Offline analysis of existing Cloud Logging exports. No cloud I/O.
const EVENTS = new Set([
  'VIDEO_CANCELLATION_CYCLE_STARTED',
  'VIDEO_CANCELLATION_CYCLE_FINISHED',
  'VIDEO_CANCELLATION_CYCLE_FAILED',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNTERS = [
  'selected', 'claimed', 'invalid', 'claimSkipped', 'completed',
  'retryScheduled', 'unconfirmed', 'replaced', 'taskRejected', 'durationMs',
];
function parseTimestamp(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function safeInt(value) {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function cleanCompletion(payload, at) {
  const metrics = {};
  for (const key of COUNTERS) metrics[key] = safeInt(payload[key]);
  return {
    at,
    status: ['OK', 'ATTENTION'].includes(payload.status)
      ? payload.status : 'UNKNOWN',
    batchLimitReached: payload.batchLimitReached === true,
    metrics,
  };
}
export function summarizeExportedCancellationLogs(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length > 2000) {
    throw new Error('Exportação inválida ou excede 2.000 entradas.');
  }
  const exportLimit = options.exportLimit ?? 500;
  const cycles = new Map();
  let acceptedEvents = 0;
  let ignoredEvents = 0;
  for (const entry of entries) {
    const payload = entry && typeof entry === 'object' ? entry.jsonPayload : null;
    const event = payload?.event;
    if (!EVENTS.has(event)) {
      ignoredEvents += 1;
      continue;
    }
    const id = payload.cycleId;
    const at = parseTimestamp(entry.timestamp);
    if (typeof id !== 'string' || !UUID.test(id) || !at) {
      ignoredEvents += 1;
      continue;
    }
    acceptedEvents += 1;
    const cycle = cycles.get(id) ?? { startedAt: null, finished: null, failedAt: null };
    if (event === 'VIDEO_CANCELLATION_CYCLE_STARTED') {
      if (!cycle.startedAt || at > cycle.startedAt) cycle.startedAt = at;
    } else if (event === 'VIDEO_CANCELLATION_CYCLE_FINISHED') {
      if (!cycle.finished || at > cycle.finished.at) {
        cycle.finished = cleanCompletion(payload, at);
      }
    } else if (!cycle.failedAt || at > cycle.failedAt) {
      cycle.failedAt = at;
    }
    cycles.set(id, cycle);
  }
  let finishedCycles = 0;
  let failedCycles = 0;
  let startedWithoutTerminal = 0;
  let terminalWithoutStart = 0;
  let latestStartedAt = null;
  let latestTerminalAt = null;
  let latestCompletion = null;
  for (const cycle of cycles.values()) {
    if (cycle.startedAt) {
      if (!latestStartedAt || cycle.startedAt > latestStartedAt) {
        latestStartedAt = cycle.startedAt;
      }
      if (!cycle.finished && !cycle.failedAt) startedWithoutTerminal += 1;
    }
    if (cycle.finished) {
      finishedCycles += 1;
      if (!latestCompletion || cycle.finished.at > latestCompletion.at) {
        latestCompletion = cycle.finished;
      }
    }
    if (cycle.failedAt) failedCycles += 1;
    if (!cycle.startedAt && (cycle.finished || cycle.failedAt)) {
      terminalWithoutStart += 1;
    }
    const terminal = [cycle.finished?.at, cycle.failedAt].filter(Boolean).sort().at(-1);
    if (terminal && (!latestTerminalAt || terminal > latestTerminalAt)) {
      latestTerminalAt = terminal;
    }
  }
  return {
    evidence: 'EXPORTED_LOGS_ONLY',
    schedulerHealth: 'NOT_VERIFIED',
    exportedEntries: entries.length,
    acceptedEvents,
    ignoredEvents,
    observedCycles: cycles.size,
    finishedCycles,
    failedCycles,
    startedWithoutTerminal,
    terminalWithoutStart,
    latestStartedAt,
    latestTerminalAt,
    latestCompletion,
    sampleMayBeTruncated: entries.length >= exportLimit,
  };
}

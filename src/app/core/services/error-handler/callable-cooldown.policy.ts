export interface ICallableCooldownState {
  scope: string;
  active: boolean;
  expiresAt: number;
  remainingMs: number;
  remainingSeconds: number;
}

const MIN_RETRY_AFTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 10 * 60 * 1_000;
const DEFAULT_RETRY_AFTER_MS = 5_000;

interface ErrorCandidate {
  code?: unknown;
  details?: unknown;
  data?: unknown;
  customData?: unknown;
  original?: unknown;
  cause?: unknown;
}

function normalizePositiveInteger(value: unknown): number | null {
  const numeric = Number(value);

  return Number.isFinite(numeric) && numeric > 0
    ? Math.trunc(numeric)
    : null;
}

function normalizeRetryAfterMs(value: unknown, fallbackMs: number): number {
  const numeric = normalizePositiveInteger(value) ??
    normalizePositiveInteger(fallbackMs) ??
    DEFAULT_RETRY_AFTER_MS;

  return Math.max(
    MIN_RETRY_AFTER_MS,
    Math.min(MAX_RETRY_AFTER_MS, numeric)
  );
}

function normalizeCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^functions\//, '')
    .replace(/^firebase-functions\//, '');
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function errorCandidates(error: unknown): Readonly<Record<string, unknown>>[] {
  const queue: unknown[] = [error];
  const visited = new Set<object>();
  const result: Readonly<Record<string, unknown>>[] = [];

  while (queue.length > 0 && result.length < 12) {
    const current = queue.shift();
    const record = objectRecord(current);

    if (!record || visited.has(record as object)) {
      continue;
    }

    visited.add(record as object);
    result.push(record);

    const candidate = record as ErrorCandidate;
    queue.push(
      candidate.original,
      candidate.cause,
      candidate.details,
      candidate.data,
      candidate.customData
    );
  }

  return result;
}

export function isCallableResourceExhausted(error: unknown): boolean {
  return errorCandidates(error).some(
    (candidate) => normalizeCode(candidate['code']) === 'resource-exhausted'
  );
}

export function resolveCallableRetryAfterMs(
  error: unknown,
  fallbackMs = DEFAULT_RETRY_AFTER_MS
): number {
  for (const candidate of errorCandidates(error)) {
    const direct = normalizePositiveInteger(candidate['retryAfterMs']);

    if (direct !== null) {
      return normalizeRetryAfterMs(direct, fallbackMs);
    }
  }

  return normalizeRetryAfterMs(fallbackMs, DEFAULT_RETRY_AFTER_MS);
}

export function buildCallableCooldownState(
  scope: string,
  expiresAt: number,
  now = Date.now()
): ICallableCooldownState {
  const safeExpiresAt = normalizePositiveInteger(expiresAt) ?? 0;
  const safeNow = normalizePositiveInteger(now) ?? 0;
  const remainingMs = Math.max(0, safeExpiresAt - safeNow);

  return {
    scope: String(scope ?? '').trim(),
    active: remainingMs > 0,
    expiresAt: safeExpiresAt,
    remainingMs,
    remainingSeconds: remainingMs > 0
      ? Math.max(1, Math.ceil(remainingMs / 1_000))
      : 0,
  };
}

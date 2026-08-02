export const VIDEO_VIEW_SESSION_TTL_MS = 15 * 60 * 1000;
export const VIDEO_VIEW_SESSION_RATE_WINDOW_MS = 10 * 60 * 1000;
export const VIDEO_VIEW_SESSION_GLOBAL_MAX_PER_WINDOW = 30;
export const VIDEO_VIEW_SESSION_VIDEO_MAX_PER_WINDOW = 6;
export const VIDEO_VIEW_SESSION_MIN_INTERVAL_MS = 2_000;

const MIN_SESSION_TOKEN_LENGTH = 32;
const MAX_SESSION_TOKEN_LENGTH = 128;

export interface VideoViewSessionRateState {
  windowStartedAt: number;
  count: number;
  lastIssuedAt: number;
}

export interface VideoViewSessionRateDecision {
  allowed: boolean;
  retryAfterMs: number;
  nextState: VideoViewSessionRateState;
}

function normalizeNonNegativeNumber(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.floor(numberValue)
    : 0;
}

export function normalizeVideoViewSessionToken(value: unknown): string {
  const token = String(value ?? '').trim();

  if (
    token.length < MIN_SESSION_TOKEN_LENGTH ||
    token.length > MAX_SESSION_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    return '';
  }

  return token;
}

export function buildVideoViewSessionRateDecision(input: {
  now: number;
  state: Partial<VideoViewSessionRateState> | null | undefined;
  maxPerWindow: number;
  windowMs?: number;
  minIntervalMs?: number;
}): VideoViewSessionRateDecision {
  const now = normalizeNonNegativeNumber(input.now);
  const windowMs = Math.max(
    1,
    normalizeNonNegativeNumber(input.windowMs) ||
      VIDEO_VIEW_SESSION_RATE_WINDOW_MS
  );
  const minIntervalMs = Math.max(
    0,
    normalizeNonNegativeNumber(input.minIntervalMs) ||
      VIDEO_VIEW_SESSION_MIN_INTERVAL_MS
  );
  const maxPerWindow = Math.max(1, Math.floor(input.maxPerWindow));
  const previousWindowStartedAt = normalizeNonNegativeNumber(
    input.state?.windowStartedAt
  );
  const previousCount = normalizeNonNegativeNumber(input.state?.count);
  const previousLastIssuedAt = normalizeNonNegativeNumber(
    input.state?.lastIssuedAt
  );
  const windowExpired =
    previousWindowStartedAt <= 0 ||
    now - previousWindowStartedAt >= windowMs;
  const windowStartedAt = windowExpired ? now : previousWindowStartedAt;
  const count = windowExpired ? 0 : previousCount;
  const intervalRemainingMs = previousLastIssuedAt > 0
    ? Math.max(0, minIntervalMs - (now - previousLastIssuedAt))
    : 0;
  const windowRemainingMs = Math.max(
    0,
    windowMs - (now - windowStartedAt)
  );

  if (intervalRemainingMs > 0) {
    return {
      allowed: false,
      retryAfterMs: intervalRemainingMs,
      nextState: {
        windowStartedAt,
        count,
        lastIssuedAt: previousLastIssuedAt,
      },
    };
  }

  if (count >= maxPerWindow) {
    return {
      allowed: false,
      retryAfterMs: windowRemainingMs,
      nextState: {
        windowStartedAt,
        count,
        lastIssuedAt: previousLastIssuedAt,
      },
    };
  }

  return {
    allowed: true,
    retryAfterMs: 0,
    nextState: {
      windowStartedAt,
      count: count + 1,
      lastIssuedAt: now,
    },
  };
}

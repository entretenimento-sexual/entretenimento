export type MediaCallableRateAction =
  | 'REACTION'
  | 'COMMENT_CREATE'
  | 'COMMENT_MODERATE'
  | 'RATING'
  | 'REPORT'
  | 'SHARE_AUTHORIZE'
  | 'SHARE_MESSAGE';

export interface MediaCallableRateLimitRule {
  readonly windowMs: number;
  readonly globalMaxPerWindow: number;
  readonly resourceMaxPerWindow: number;
  readonly minIntervalMs: number;
}

export interface MediaCallableRateState {
  readonly windowStartedAt: number;
  readonly count: number;
  readonly lastAcceptedAt: number;
}

export interface MediaCallableRateDecisionInput {
  readonly now: number;
  readonly state: Partial<MediaCallableRateState> | null | undefined;
  readonly maxPerWindow: number;
  readonly windowMs: number;
  readonly minIntervalMs: number;
}

export interface MediaCallableRateDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
  readonly nextState: MediaCallableRateState;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

const RULES: Readonly<Record<
  MediaCallableRateAction,
  MediaCallableRateLimitRule
>> = {
  REACTION: {
    windowMs: TEN_MINUTES_MS,
    globalMaxPerWindow: 120,
    resourceMaxPerWindow: 12,
    minIntervalMs: 250,
  },
  COMMENT_CREATE: {
    windowMs: TEN_MINUTES_MS,
    globalMaxPerWindow: 24,
    resourceMaxPerWindow: 6,
    minIntervalMs: 1_500,
  },
  COMMENT_MODERATE: {
    windowMs: TEN_MINUTES_MS,
    globalMaxPerWindow: 180,
    resourceMaxPerWindow: 60,
    minIntervalMs: 100,
  },
  RATING: {
    windowMs: TEN_MINUTES_MS,
    globalMaxPerWindow: 60,
    resourceMaxPerWindow: 10,
    minIntervalMs: 500,
  },
  REPORT: {
    windowMs: ONE_HOUR_MS,
    globalMaxPerWindow: 12,
    resourceMaxPerWindow: 2,
    minIntervalMs: 3_000,
  },
  SHARE_AUTHORIZE: {
    windowMs: TEN_MINUTES_MS,
    globalMaxPerWindow: 180,
    resourceMaxPerWindow: 30,
    minIntervalMs: 150,
  },
  SHARE_MESSAGE: {
    windowMs: TEN_MINUTES_MS,
    globalMaxPerWindow: 60,
    resourceMaxPerWindow: 12,
    minIntervalMs: 500,
  },
};

function normalizeNonNegativeInteger(value: unknown): number {
  const numberValue = Number(value ?? 0);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.floor(numberValue)
    : 0;
}

export function resolveMediaCallableRateLimitRule(
  action: MediaCallableRateAction
): MediaCallableRateLimitRule {
  return RULES[action];
}

export function buildMediaCallableRateDecision(
  input: MediaCallableRateDecisionInput
): MediaCallableRateDecision {
  const now = normalizeNonNegativeInteger(input.now);
  const maxPerWindow = Math.max(
    1,
    normalizeNonNegativeInteger(input.maxPerWindow)
  );
  const windowMs = Math.max(
    1_000,
    normalizeNonNegativeInteger(input.windowMs)
  );
  const minIntervalMs = normalizeNonNegativeInteger(input.minIntervalMs);
  const previousWindowStartedAt = normalizeNonNegativeInteger(
    input.state?.windowStartedAt
  );
  const previousCount = normalizeNonNegativeInteger(input.state?.count);
  const previousLastAcceptedAt = normalizeNonNegativeInteger(
    input.state?.lastAcceptedAt
  );
  const windowExpired =
    previousWindowStartedAt <= 0 ||
    now - previousWindowStartedAt >= windowMs;
  const windowStartedAt = windowExpired ? now : previousWindowStartedAt;
  const count = windowExpired ? 0 : previousCount;
  const intervalRemainingMs = Math.max(
    0,
    minIntervalMs - (now - previousLastAcceptedAt)
  );
  const windowRemainingMs = Math.max(
    1_000,
    windowMs - Math.max(0, now - windowStartedAt)
  );
  const reachedWindowLimit = count >= maxPerWindow;
  const allowed = !reachedWindowLimit && intervalRemainingMs === 0;

  if (!allowed) {
    return {
      allowed: false,
      retryAfterMs: reachedWindowLimit
        ? windowRemainingMs
        : Math.max(1_000, intervalRemainingMs),
      nextState: {
        windowStartedAt,
        count,
        lastAcceptedAt: previousLastAcceptedAt,
      },
    };
  }

  return {
    allowed: true,
    retryAfterMs: minIntervalMs,
    nextState: {
      windowStartedAt,
      count: count + 1,
      lastAcceptedAt: now,
    },
  };
}

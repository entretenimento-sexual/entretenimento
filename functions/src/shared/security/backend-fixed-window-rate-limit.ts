export interface BackendFixedWindowRateLimitState {
  burstWindowStartedAt?: unknown;
  burstCount?: unknown;
  sustainedWindowStartedAt?: unknown;
  sustainedCount?: unknown;
}

export interface NormalizedBackendFixedWindowRateLimitState {
  burstWindowStartedAt: number;
  burstCount: number;
  sustainedWindowStartedAt: number;
  sustainedCount: number;
}

export interface BackendFixedWindowRateLimitConfig {
  burstWindowMs: number;
  burstMax: number;
  sustainedWindowMs: number;
  sustainedMax: number;
}

export interface BackendFixedWindowRateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
  nextState: NormalizedBackendFixedWindowRateLimitState;
}

function safeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizePositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} precisa ser um inteiro positivo.`);
  }
  return Math.floor(parsed);
}

function normalizeWindow(input: {
  now: number;
  windowStartedAt: unknown;
  count: unknown;
  windowMs: number;
}): { windowStartedAt: number; count: number } {
  const previousStartedAt = safeNonNegativeInteger(input.windowStartedAt);
  const previousCount = safeNonNegativeInteger(input.count);
  const expired = previousStartedAt <= 0
    || input.now < previousStartedAt
    || input.now - previousStartedAt >= input.windowMs;

  return expired
    ? { windowStartedAt: input.now, count: 0 }
    : { windowStartedAt: previousStartedAt, count: previousCount };
}

export function buildBackendFixedWindowRateLimitDecision(input: {
  now: number;
  state?: BackendFixedWindowRateLimitState | null;
  cost?: number;
  config: BackendFixedWindowRateLimitConfig;
}): BackendFixedWindowRateLimitDecision {
  const now = safeNonNegativeInteger(input.now);
  if (!now) throw new Error('O relógio do rate limit precisa ser válido.');

  const cost = normalizePositiveInteger(input.cost ?? 1, 'cost');
  const burstWindowMs = normalizePositiveInteger(input.config.burstWindowMs, 'burstWindowMs');
  const burstMax = normalizePositiveInteger(input.config.burstMax, 'burstMax');
  const sustainedWindowMs = normalizePositiveInteger(
    input.config.sustainedWindowMs,
    'sustainedWindowMs'
  );
  const sustainedMax = normalizePositiveInteger(
    input.config.sustainedMax,
    'sustainedMax'
  );

  if (cost > burstMax || cost > sustainedMax) {
    throw new Error('O custo da operação excede a capacidade da janela.');
  }

  const state = input.state ?? {};
  const burst = normalizeWindow({
    now,
    windowStartedAt: state.burstWindowStartedAt,
    count: state.burstCount,
    windowMs: burstWindowMs,
  });
  const sustained = normalizeWindow({
    now,
    windowStartedAt: state.sustainedWindowStartedAt,
    count: state.sustainedCount,
    windowMs: sustainedWindowMs,
  });
  const burstBlocked = burst.count + cost > burstMax;
  const sustainedBlocked = sustained.count + cost > sustainedMax;

  if (burstBlocked || sustainedBlocked) {
    const burstRetryAfterMs = burstBlocked
      ? Math.max(1, burstWindowMs - (now - burst.windowStartedAt))
      : 0;
    const sustainedRetryAfterMs = sustainedBlocked
      ? Math.max(1, sustainedWindowMs - (now - sustained.windowStartedAt))
      : 0;

    return {
      allowed: false,
      retryAfterMs: Math.max(burstRetryAfterMs, sustainedRetryAfterMs),
      nextState: {
        burstWindowStartedAt: burst.windowStartedAt,
        burstCount: burst.count,
        sustainedWindowStartedAt: sustained.windowStartedAt,
        sustainedCount: sustained.count,
      },
    };
  }

  return {
    allowed: true,
    retryAfterMs: 0,
    nextState: {
      burstWindowStartedAt: burst.windowStartedAt,
      burstCount: burst.count + cost,
      sustainedWindowStartedAt: sustained.windowStartedAt,
      sustainedCount: sustained.count + cost,
    },
  };
}

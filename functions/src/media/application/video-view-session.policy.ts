export const VIDEO_VIEW_SESSION_TTL_MS = 15 * 60 * 1000;
export const VIDEO_VIEW_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
export const VIDEO_VIEW_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const VIDEO_VIEW_RATE_LIMIT_GLOBAL_MAX = 40;
export const VIDEO_VIEW_RATE_LIMIT_PER_VIDEO_MAX = 6;

export interface FixedWindowRateLimitState {
  readonly windowStartedAt?: unknown;
  readonly count?: unknown;
}

export interface FixedWindowRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
  readonly nextWindowStartedAt: number;
  readonly nextCount: number;
}

export interface StoredVideoViewSession {
  readonly viewerUid?: unknown;
  readonly ownerUid?: unknown;
  readonly videoId?: unknown;
  readonly status?: unknown;
  readonly appIdHash?: unknown;
  readonly requiredPlaybackMs?: unknown;
  readonly serverDurationMs?: unknown;
  readonly expiresAtMs?: unknown;
}

export interface VideoViewSessionValidationInput {
  readonly session: StoredVideoViewSession | null | undefined;
  readonly viewerUid: string;
  readonly ownerUid: string;
  readonly videoId: string;
  readonly appIdHash: string;
  readonly now: number;
}

export interface VideoViewSessionValidationDecision {
  readonly allowed: boolean;
  readonly reason:
    | 'missing'
    | 'identity_mismatch'
    | 'app_mismatch'
    | 'not_issued'
    | 'expired'
    | null;
}

function safeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export function evaluateFixedWindowRateLimit(params: {
  readonly state: FixedWindowRateLimitState | null | undefined;
  readonly now: number;
  readonly windowMs: number;
  readonly maxCount: number;
}): FixedWindowRateLimitDecision {
  const now = safeInteger(params.now);
  const windowMs = Math.max(1, safeInteger(params.windowMs));
  const maxCount = Math.max(1, safeInteger(params.maxCount));
  const existingStartedAt = safeInteger(params.state?.windowStartedAt);
  const existingCount = safeInteger(params.state?.count);
  const expired =
    existingStartedAt <= 0 || now - existingStartedAt >= windowMs;
  const windowStartedAt = expired ? now : existingStartedAt;
  const count = expired ? 0 : existingCount;
  const allowed = count < maxCount;

  return {
    allowed,
    retryAfterMs: allowed
      ? 0
      : Math.max(1, windowMs - (now - windowStartedAt)),
    nextWindowStartedAt: windowStartedAt,
    nextCount: allowed ? count + 1 : count,
  };
}

export function evaluateVideoViewSession(
  input: VideoViewSessionValidationInput
): VideoViewSessionValidationDecision {
  const session = input.session;

  if (!session) {
    return { allowed: false, reason: 'missing' };
  }

  if (
    clean(session.viewerUid) !== clean(input.viewerUid) ||
    clean(session.ownerUid) !== clean(input.ownerUid) ||
    clean(session.videoId) !== clean(input.videoId)
  ) {
    return { allowed: false, reason: 'identity_mismatch' };
  }

  const expectedAppIdHash = clean(input.appIdHash);
  const storedAppIdHash = clean(session.appIdHash);

  if (
    expectedAppIdHash &&
    storedAppIdHash &&
    storedAppIdHash !== expectedAppIdHash
  ) {
    return { allowed: false, reason: 'app_mismatch' };
  }

  if (clean(session.status).toUpperCase() !== 'ISSUED') {
    return { allowed: false, reason: 'not_issued' };
  }

  const expiresAtMs = safeInteger(session.expiresAtMs);
  if (expiresAtMs <= safeInteger(input.now)) {
    return { allowed: false, reason: 'expired' };
  }

  return { allowed: true, reason: null };
}

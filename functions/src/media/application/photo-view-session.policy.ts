export const PHOTO_VIEW_MIN_VISIBLE_MS = 2_000;
export const PHOTO_VIEW_SESSION_TTL_MS = 10 * 60 * 1000;
export const PHOTO_VIEW_SESSION_RATE_WINDOW_MS = 10 * 60 * 1000;
export const PHOTO_VIEW_SESSION_GLOBAL_MAX_PER_WINDOW = 60;
export const PHOTO_VIEW_SESSION_PHOTO_MAX_PER_WINDOW = 10;
export const PHOTO_VIEW_SESSION_MIN_INTERVAL_MS = 1_000;

const MIN_SESSION_TOKEN_LENGTH = 32;
const MAX_SESSION_TOKEN_LENGTH = 128;

export interface PhotoViewSessionRateState {
  windowStartedAt: number;
  count: number;
  lastIssuedAt: number;
}

export interface PhotoViewSessionRateDecision {
  allowed: boolean;
  retryAfterMs: number;
  nextState: PhotoViewSessionRateState;
}

export interface PhotoViewEvidenceInput {
  sessionId?: unknown;
  visibleMs?: unknown;
  qualifiedAt?: unknown;
}

export interface NormalizedPhotoViewEvidence {
  sessionId: string;
  visibleMs: number;
  qualifiedAt: number;
}

function normalizeNonNegativeNumber(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.floor(numberValue)
    : 0;
}

export function normalizePhotoViewSessionToken(value: unknown): string {
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

export function normalizePhotoViewEvidence(
  evidence: PhotoViewEvidenceInput | null | undefined
): NormalizedPhotoViewEvidence | null {
  const sessionId = normalizePhotoViewSessionToken(evidence?.sessionId);
  const visibleMs = normalizeNonNegativeNumber(evidence?.visibleMs);
  const qualifiedAt = normalizeNonNegativeNumber(evidence?.qualifiedAt);

  if (
    !sessionId ||
    visibleMs < PHOTO_VIEW_MIN_VISIBLE_MS ||
    visibleMs > PHOTO_VIEW_SESSION_TTL_MS ||
    !qualifiedAt
  ) {
    return null;
  }

  return {
    sessionId,
    visibleMs,
    qualifiedAt,
  };
}

export function buildPhotoViewSessionRateDecision(input: {
  now: number;
  state: Partial<PhotoViewSessionRateState> | null | undefined;
  maxPerWindow: number;
  windowMs?: number;
  minIntervalMs?: number;
}): PhotoViewSessionRateDecision {
  const now = normalizeNonNegativeNumber(input.now);
  const windowMs = Math.max(
    1,
    normalizeNonNegativeNumber(input.windowMs) ||
      PHOTO_VIEW_SESSION_RATE_WINDOW_MS
  );
  const minIntervalMs = Math.max(
    0,
    normalizeNonNegativeNumber(input.minIntervalMs) ||
      PHOTO_VIEW_SESSION_MIN_INTERVAL_MS
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

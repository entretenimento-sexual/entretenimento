export const PHOTO_UPLOAD_RESERVATION_TTL_MS = 15 * 60 * 1000;
export const PHOTO_UPLOAD_QUOTA_WINDOW_MS = 60 * 60 * 1000;
export const PHOTO_UPLOAD_MAX_RESERVATIONS_PER_WINDOW = 60;
export const PHOTO_UPLOAD_MAX_BYTES_PER_WINDOW = 300 * 1024 * 1024;

export interface PhotoUploadQuotaState {
  windowStartedAtMs: number;
  reservedCount: number;
  reservedBytes: number;
}

export type PhotoUploadQuotaDenialReason =
  | 'reservation_count_exceeded'
  | 'reserved_bytes_exceeded';

export type PhotoUploadQuotaDecision =
  | {
      allowed: true;
      nextState: PhotoUploadQuotaState;
      retryAfterMs: 0;
    }
  | {
      allowed: false;
      reason: PhotoUploadQuotaDenialReason;
      nextState: PhotoUploadQuotaState;
      retryAfterMs: number;
    };

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed));
}

export function normalizePhotoUploadQuotaState(
  value: unknown,
  nowMs: number
): PhotoUploadQuotaState {
  const now = Math.max(0, Math.trunc(nowMs));
  const currentWindow =
    Math.floor(now / PHOTO_UPLOAD_QUOTA_WINDOW_MS) *
    PHOTO_UPLOAD_QUOTA_WINDOW_MS;

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      windowStartedAtMs: currentWindow,
      reservedCount: 0,
      reservedBytes: 0,
    };
  }

  const raw = value as Record<string, unknown>;
  const storedWindow = normalizeNonNegativeInteger(raw['windowStartedAtMs']);

  if (storedWindow !== currentWindow) {
    return {
      windowStartedAtMs: currentWindow,
      reservedCount: 0,
      reservedBytes: 0,
    };
  }

  return {
    windowStartedAtMs: currentWindow,
    reservedCount: normalizeNonNegativeInteger(raw['reservedCount']),
    reservedBytes: normalizeNonNegativeInteger(raw['reservedBytes']),
  };
}

export function evaluatePhotoUploadQuota(
  currentValue: unknown,
  requestedBytes: number,
  nowMs: number
): PhotoUploadQuotaDecision {
  const state = normalizePhotoUploadQuotaState(currentValue, nowMs);
  const safeRequestedBytes = normalizeNonNegativeInteger(requestedBytes);
  const retryAfterMs = Math.max(
    1,
    state.windowStartedAtMs + PHOTO_UPLOAD_QUOTA_WINDOW_MS - nowMs
  );

  if (state.reservedCount + 1 > PHOTO_UPLOAD_MAX_RESERVATIONS_PER_WINDOW) {
    return {
      allowed: false,
      reason: 'reservation_count_exceeded',
      nextState: state,
      retryAfterMs,
    };
  }

  if (state.reservedBytes + safeRequestedBytes > PHOTO_UPLOAD_MAX_BYTES_PER_WINDOW) {
    return {
      allowed: false,
      reason: 'reserved_bytes_exceeded',
      nextState: state,
      retryAfterMs,
    };
  }

  return {
    allowed: true,
    nextState: {
      ...state,
      reservedCount: state.reservedCount + 1,
      reservedBytes: state.reservedBytes + safeRequestedBytes,
    },
    retryAfterMs: 0,
  };
}

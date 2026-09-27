export const VIDEO_UPLOAD_RESERVATION_TTL_MS = 15 * 60 * 1000;
export const VIDEO_UPLOAD_QUOTA_WINDOW_MS = 60 * 60 * 1000;

/**
 * Limites operacionais de proteção, não comerciais.
 *
 * A quantidade limita abuso de criação de reservas; bytes limita custo bruto de
 * Storage/egress/processamento antes que qualquer regra de produto seja aplicada.
 * Esses valores podem ser recalibrados posteriormente com telemetria real sem
 * alterar o contrato da reserva.
 */
export const VIDEO_UPLOAD_MAX_RESERVATIONS_PER_WINDOW = 12;
export const VIDEO_UPLOAD_MAX_BYTES_PER_WINDOW = 2 * 1024 * 1024 * 1024;

export interface VideoUploadQuotaState {
  windowStartedAtMs: number;
  reservedCount: number;
  reservedBytes: number;
}

export type VideoUploadQuotaDenialReason =
  | 'reservation_count_exceeded'
  | 'reserved_bytes_exceeded';

export type VideoUploadQuotaDecision =
  | {
      allowed: true;
      nextState: VideoUploadQuotaState;
      retryAfterMs: 0;
    }
  | {
      allowed: false;
      reason: VideoUploadQuotaDenialReason;
      nextState: VideoUploadQuotaState;
      retryAfterMs: number;
    };

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed));
}

export function normalizeVideoUploadQuotaState(
  value: unknown,
  nowMs: number
): VideoUploadQuotaState {
  const now = Math.max(0, Math.trunc(nowMs));
  const currentWindow =
    Math.floor(now / VIDEO_UPLOAD_QUOTA_WINDOW_MS) *
    VIDEO_UPLOAD_QUOTA_WINDOW_MS;

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

export function evaluateVideoUploadQuota(
  currentValue: unknown,
  requestedBytes: number,
  nowMs: number
): VideoUploadQuotaDecision {
  const state = normalizeVideoUploadQuotaState(currentValue, nowMs);
  const safeRequestedBytes = normalizeNonNegativeInteger(requestedBytes);
  const retryAfterMs = Math.max(
    1,
    state.windowStartedAtMs + VIDEO_UPLOAD_QUOTA_WINDOW_MS - nowMs
  );

  if (state.reservedCount + 1 > VIDEO_UPLOAD_MAX_RESERVATIONS_PER_WINDOW) {
    return {
      allowed: false,
      reason: 'reservation_count_exceeded',
      nextState: state,
      retryAfterMs,
    };
  }

  if (state.reservedBytes + safeRequestedBytes > VIDEO_UPLOAD_MAX_BYTES_PER_WINDOW) {
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

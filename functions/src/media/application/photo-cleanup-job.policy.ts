export type PhotoCleanupJobState =
  | 'retryable'
  | 'waiting_retention'
  | 'dead_letter';

export const PHOTO_CLEANUP_MAX_ATTEMPTS = 8;
export const PHOTO_CLEANUP_RETRY_BASE_MS = 15 * 60 * 1000;
export const PHOTO_CLEANUP_RETRY_MAX_MS = 24 * 60 * 60 * 1000;
export const PHOTO_CLEANUP_RETENTION_RECHECK_MS = 6 * 60 * 60 * 1000;
export const PHOTO_CLEANUP_DEAD_LETTER_RETENTION_MS =
  30 * 24 * 60 * 60 * 1000;

export interface PhotoCleanupRetryDecision {
  state: Extract<PhotoCleanupJobState, 'retryable' | 'dead_letter'>;
  attempts: number;
  nextAttemptAt: number | null;
  deadLetterExpiresAt: number | null;
}

export function nextPhotoCleanupRetry(
  currentAttempts: unknown,
  now = Date.now()
): PhotoCleanupRetryDecision {
  const normalizedAttempts = Number.isFinite(Number(currentAttempts))
    ? Math.max(0, Math.trunc(Number(currentAttempts)))
    : 0;
  const attempts = normalizedAttempts + 1;

  if (attempts >= PHOTO_CLEANUP_MAX_ATTEMPTS) {
    return {
      state: 'dead_letter',
      attempts,
      nextAttemptAt: null,
      deadLetterExpiresAt: now + PHOTO_CLEANUP_DEAD_LETTER_RETENTION_MS,
    };
  }

  const exponent = Math.max(0, attempts - 1);
  const delayMs = Math.min(
    PHOTO_CLEANUP_RETRY_MAX_MS,
    PHOTO_CLEANUP_RETRY_BASE_MS * 2 ** exponent
  );

  return {
    state: 'retryable',
    attempts,
    nextAttemptAt: now + delayMs,
    deadLetterExpiresAt: null,
  };
}

export function photoCleanupRetentionRecheckAt(
  now = Date.now()
): number {
  return now + PHOTO_CLEANUP_RETENTION_RECHECK_MS;
}

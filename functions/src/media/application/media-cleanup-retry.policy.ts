/**
 * Política comum de retentativas de limpeza física de Media.
 * A decisão é pura: persistência, seleção de jobs e leases pertencem ao adapter.
 */
export type MediaCleanupJobState =
  | 'retryable'
  | 'waiting_retention'
  | 'dead_letter';

export const MEDIA_CLEANUP_MAX_ATTEMPTS = 8;
export const MEDIA_CLEANUP_RETRY_BASE_MS = 15 * 60 * 1000;
export const MEDIA_CLEANUP_RETRY_MAX_MS = 24 * 60 * 60 * 1000;
export const MEDIA_CLEANUP_RETENTION_RECHECK_MS = 6 * 60 * 60 * 1000;
export const MEDIA_CLEANUP_DEAD_LETTER_RETENTION_MS =
  30 * 24 * 60 * 60 * 1000;

export interface MediaCleanupRetryDecision {
  state: Extract<MediaCleanupJobState, 'retryable' | 'dead_letter'>;
  attempts: number;
  nextAttemptAt: number | null;
  deadLetterExpiresAt: number | null;
}

export interface MediaCleanupRetryOptions {
  /** null: não descartar automaticamente jobs de arquivos ainda existentes. */
  deadLetterRetentionMs?: number | null;
}

export function nextMediaCleanupRetry(
  currentAttempts: unknown,
  now = Date.now(),
  options: MediaCleanupRetryOptions = {}
): MediaCleanupRetryDecision {
  const normalizedAttempts = Number.isFinite(Number(currentAttempts))
    ? Math.max(0, Math.trunc(Number(currentAttempts)))
    : 0;
  const attempts = normalizedAttempts + 1;

  if (attempts >= MEDIA_CLEANUP_MAX_ATTEMPTS) {
    const deadLetterRetentionMs = options.deadLetterRetentionMs === undefined
      ? MEDIA_CLEANUP_DEAD_LETTER_RETENTION_MS
      : options.deadLetterRetentionMs;

    return {
      state: 'dead_letter',
      attempts,
      nextAttemptAt: null,
      deadLetterExpiresAt: deadLetterRetentionMs === null
        ? null
        : now + deadLetterRetentionMs,
    };
  }

  const exponent = Math.max(0, attempts - 1);
  const delayMs = Math.min(
    MEDIA_CLEANUP_RETRY_MAX_MS,
    MEDIA_CLEANUP_RETRY_BASE_MS * 2 ** exponent
  );

  return {
    state: 'retryable',
    attempts,
    nextAttemptAt: now + delayMs,
    deadLetterExpiresAt: null,
  };
}

export function mediaCleanupRetentionRecheckAt(
  now = Date.now()
): number {
  return now + MEDIA_CLEANUP_RETENTION_RECHECK_MS;
}

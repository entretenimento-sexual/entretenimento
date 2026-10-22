/**
 * API de compatibilidade de Fotos. A política de retentativas pertence a Media.
 * Os nomes e o comportamento histórico permanecem iguais.
 */
import {
  MEDIA_CLEANUP_DEAD_LETTER_RETENTION_MS,
  MEDIA_CLEANUP_MAX_ATTEMPTS,
  MEDIA_CLEANUP_RETENTION_RECHECK_MS,
  MEDIA_CLEANUP_RETRY_BASE_MS,
  MEDIA_CLEANUP_RETRY_MAX_MS,
  mediaCleanupRetentionRecheckAt,
  nextMediaCleanupRetry,
  type MediaCleanupJobState,
  type MediaCleanupRetryDecision,
} from './media-cleanup-retry.policy';

export type PhotoCleanupJobState = MediaCleanupJobState;
export type PhotoCleanupRetryDecision = MediaCleanupRetryDecision;

export const PHOTO_CLEANUP_MAX_ATTEMPTS = MEDIA_CLEANUP_MAX_ATTEMPTS;
export const PHOTO_CLEANUP_RETRY_BASE_MS = MEDIA_CLEANUP_RETRY_BASE_MS;
export const PHOTO_CLEANUP_RETRY_MAX_MS = MEDIA_CLEANUP_RETRY_MAX_MS;
export const PHOTO_CLEANUP_RETENTION_RECHECK_MS = MEDIA_CLEANUP_RETENTION_RECHECK_MS;
export const PHOTO_CLEANUP_DEAD_LETTER_RETENTION_MS =
  MEDIA_CLEANUP_DEAD_LETTER_RETENTION_MS;

/**
 * Physical photo cleanup obligations must not disappear on a timer.
 * Preserve terminal jobs until an explicit, audited reconciliation.
 */
export function nextPhotoCleanupRetry(currentAttempts: unknown, now = Date.now()) {
  return nextMediaCleanupRetry(currentAttempts, now, {
    deadLetterRetentionMs: null,
  });
}
export const photoCleanupRetentionRecheckAt = mediaCleanupRetentionRecheckAt;

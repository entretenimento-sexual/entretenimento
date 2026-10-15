import {
  MEDIA_CLEANUP_MAX_ATTEMPTS,
  nextMediaCleanupRetry,
  type MediaCleanupRetryDecision,
} from './media-cleanup-retry.policy';

export type VideoCleanupJobState = 'retryable' | 'dead_letter';

export interface VideoCleanupJobScheduling {
  state: VideoCleanupJobState;
  nextAttemptAt: number | null;
  requiresMigration: boolean;
}

/**
 * Para vídeos, falha definitiva exige revisão. Não expiramos dead letters
 * automaticamente enquanto o objeto físico puder continuar existindo.
 */
export function nextVideoCleanupRetry(
  currentAttempts: unknown,
  now = Date.now()
): MediaCleanupRetryDecision {
  return nextMediaCleanupRetry(currentAttempts, now, {
    deadLetterRetentionMs: null,
  });
}

/**
 * Classifica jobs anteriores à introdução do agendamento. O adapter precisa
 * percorrer/migrar esses documentos antes de depender de where(nextAttemptAt).
 */
export function resolveVideoCleanupJobScheduling(
  job: {
    attempts?: unknown;
    state?: unknown;
    nextAttemptAt?: unknown;
  },
  now: number
): VideoCleanupJobScheduling {
  const attempts = Number(job.attempts);
  const attemptCount = Number.isFinite(attempts)
    ? Math.max(0, Math.trunc(attempts))
    : 0;

  if (job.state === 'dead_letter' || attemptCount >= MEDIA_CLEANUP_MAX_ATTEMPTS) {
    return {
      state: 'dead_letter',
      nextAttemptAt: null,
      requiresMigration: job.state !== 'dead_letter' || job.nextAttemptAt !== null,
    };
  }

  const scheduledTime = job.nextAttemptAt;
  if (
    job.state === 'retryable'
    && typeof scheduledTime === 'number'
    && Number.isFinite(scheduledTime)
    && scheduledTime >= 0
  ) {
    return {
      state: 'retryable',
      nextAttemptAt: scheduledTime,
      requiresMigration: false,
    };
  }

  return {
    state: 'retryable',
    nextAttemptAt: now,
    requiresMigration: true,
  };
}

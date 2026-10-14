import type { VideoProcessingJob } from './video-processing-job';

// Scheduler runs every 30 minutes. The reservation outlasts the 9-minute
// function timeout and prevents concurrent runners from cleaning the same job.
export const CANCELLATION_RESERVATION_MS = 25 * 60_000;

export function nextCancellationRetryAt(
  attempts: number,
  now: number
): number {
  if (attempts <= 1) return now + 30 * 60_000;
  if (attempts === 2) return now + 2 * 60 * 60_000;
  return now + 24 * 60 * 60_000;
}

export function cancellationNeedsReview(
  attempts: number,
  errorCode: string
): boolean {
  return attempts >= 3 || errorCode === 'CANCELLATION_UNCONFIRMED';
}

/**
 * Fencing token for a specific cancellation claim. A delayed worker must
 * never update or delete the job after a newer worker claims its next slot.
 */
export function isCurrentCancellationClaim(
  current: VideoProcessingJob | null,
  started: VideoProcessingJob
): boolean {
  return current?.state === 'CANCEL_REQUESTED' &&
    current.processingVersion === started.processingVersion &&
    current.nextAttemptAt === started.nextAttemptAt &&
    current.ownerUid === started.ownerUid &&
    current.videoId === started.videoId;
}

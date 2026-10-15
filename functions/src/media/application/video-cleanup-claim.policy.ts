/** Pure eligibility gate; the adapter must re-evaluate it in a Firestore transaction. */
export interface VideoCleanupClaimableJob {
  state?: unknown;
  nextAttemptAt?: unknown;
  leaseUntil?: unknown;
}

export const VIDEO_CLEANUP_LEASE_MS = 30 * 60 * 1000;

export function canClaimVideoCleanupJob(
  job: VideoCleanupClaimableJob,
  now: number
): boolean {
  if (job.state !== 'retryable') return false;
  if (typeof job.nextAttemptAt !== 'number' ||
      !Number.isFinite(job.nextAttemptAt) ||
      job.nextAttemptAt > now) return false;
  if (job.leaseUntil !== null && job.leaseUntil !== undefined) {
    if (typeof job.leaseUntil !== 'number' ||
        !Number.isFinite(job.leaseUntil) ||
        job.leaseUntil > now) return false;
  }
  return true;
}

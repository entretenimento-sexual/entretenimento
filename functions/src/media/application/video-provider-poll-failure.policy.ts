import type { VideoProcessingJob } from './video-processing-job';

// Firestore due-time query deliberately excludes jobs on manual-review hold.
export const PROVIDER_POLL_REVIEW_AFTER = 3;
export const PROVIDER_POLL_HOLD_AFTER = 8;
export const PROVIDER_POLL_REVIEW_HOLD_AT = Number.MAX_SAFE_INTEGER;
const MIN_RETRY_MS = 9 * 60_000;
const MAX_RETRY_MS = 6 * 60 * 60_000;

export function isProviderPollReviewRequired(
  job: Partial<VideoProcessingJob>
): boolean {
  return job.state === 'PROCESSING' &&
    !!String(job.externalJobName ?? '').trim() &&
    job.providerPollFailureVersion === job.processingVersion &&
    job.providerPollReviewRequired === true;
}

export function nextProviderPollFailure(
  job: Pick<VideoProcessingJob,
    'processingVersion' | 'providerPollFailureVersion' | 'providerPollFailureCount'
  >,
  now: number,
  retryable: boolean
): {
  providerPollFailureVersion: string;
  providerPollFailureCount: number;
  providerPollLastFailedAt: number;
  providerPollReviewRequired: boolean;
  nextAttemptAt: number;
} {
  const consecutive = job.providerPollFailureVersion === job.processingVersion &&
    Number.isSafeInteger(job.providerPollFailureCount) &&
    Number(job.providerPollFailureCount) >= 0
    ? Number(job.providerPollFailureCount) : 0;
  const count = Math.min(PROVIDER_POLL_HOLD_AFTER, consecutive + 1);
  const review = count >= PROVIDER_POLL_REVIEW_AFTER;
  const multiplier = 2 ** Math.min(count - 1, 8);
  const baseDelay = retryable ? MIN_RETRY_MS : 30 * 60_000;
  const delay = Math.min(MAX_RETRY_MS, baseDelay * multiplier);
  return {
    providerPollFailureVersion: job.processingVersion,
    providerPollFailureCount: count,
    providerPollLastFailedAt: now,
    providerPollReviewRequired: review,
    nextAttemptAt: count >= PROVIDER_POLL_HOLD_AFTER
      ? PROVIDER_POLL_REVIEW_HOLD_AT : now + delay,
  };
}

export function clearProviderPollFailures() {
  return {
    providerPollFailureVersion: null,
    providerPollFailureCount: 0,
    providerPollLastFailedAt: null,
    providerPollReviewRequired: false,
  };
}

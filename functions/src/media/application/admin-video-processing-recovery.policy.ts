import type { VideoProcessingJob, VideoProcessingJobState } from './video-processing-job';

export type AdminVideoProcessingRecoveryAction =
  | 'RETRY_FAILED'
  | 'RECHECK_STALE'
  | 'RECHECK_UNCONFIRMED'
  | 'CANCEL_ACTIVE';

const UNCERTAIN_FAILURE_CODES = new Set([
  'SUBMISSION_NOT_FOUND',
  'SUBMISSION_UNCONFIRMED',
  'TRANSCODER_SUBMISSION_UNCONFIRMED',
]);

export function isUnconfirmedVideoSubmission(
  job: Partial<VideoProcessingJob>
): boolean {
  return job.state === 'SUBMITTING' &&
    job.lastErrorCode === 'SUBMISSION_UNCONFIRMED' &&
    job.leaseUntil === null &&
    !String(job.externalJobName ?? '').trim();
}

/** A previous POST may have succeeded even when the provider lookup was empty. */
export function isUnsafeVideoProcessingRetry(
  job: Partial<VideoProcessingJob>
): boolean {
  return job.state === 'FAILED' &&
    UNCERTAIN_FAILURE_CODES.has(String(job.lastErrorCode ?? ''));
}

export function videoRecoveryRequiresProviderReview(
  job: Partial<VideoProcessingJob>
): boolean {
  return isUnconfirmedVideoSubmission(job) ||
    isUnsafeVideoProcessingRetry(job) ||
    (job.state === 'CANCEL_REQUESTED' &&
      job.lastErrorCode === 'CANCELLATION_UNCONFIRMED');
}

export function availableAdminVideoRecoveryActions(
  job: Partial<VideoProcessingJob> & { state: VideoProcessingJobState },
  stale: boolean
): AdminVideoProcessingRecoveryAction[] {
  if (job.state === 'FAILED') {
    return isUnsafeVideoProcessingRetry(job) ? [] : ['RETRY_FAILED'];
  }
  if (job.state === 'SUBMITTING') {
    if (job.lastErrorCode === 'SUBMISSION_UNCONFIRMED') {
      return isUnconfirmedVideoSubmission(job)
        ? ['RECHECK_UNCONFIRMED', 'CANCEL_ACTIVE']
        : ['CANCEL_ACTIVE'];
    }
    return stale ? ['RECHECK_STALE', 'CANCEL_ACTIVE'] : ['CANCEL_ACTIVE'];
  }
  if (job.state === 'QUEUED') {
    return stale ? ['RECHECK_STALE', 'CANCEL_ACTIVE'] : ['CANCEL_ACTIVE'];
  }
  if (job.state === 'PROCESSING') return ['CANCEL_ACTIVE'];
  return [];
}

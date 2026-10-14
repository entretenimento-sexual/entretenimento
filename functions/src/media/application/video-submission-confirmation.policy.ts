import type { VideoProcessingJob } from './video-processing-job';

// A negative list result does not prove that a timed-out POST was rejected.
// No ambiguous submission may enter QUEUED automatically; explicit operator
// confirmation of the provider outcome is required before resubmission.
const MAX_AUTOMATIC_LOOKUPS = 3;
const LOOKUP_DELAYS_MS = [15 * 60_000, 60 * 60_000] as const;

export interface MissingSubmissionDecision {
  state: 'SUBMITTING';
  leaseUntil: number | null;
  submissionLookupMisses: number;
  lastErrorCode: 'SUBMISSION_LOOKUP_PENDING' | 'SUBMISSION_UNCONFIRMED';
  lastError: string;
}

export function decideMissingVideoSubmission(
  job: Pick<VideoProcessingJob, 'submissionLookupMisses'>,
  now: number
): MissingSubmissionDecision {
  const previous = Number.isSafeInteger(job.submissionLookupMisses)
    ? Math.max(0, job.submissionLookupMisses ?? 0)
    : 0;
  const misses = Math.min(MAX_AUTOMATIC_LOOKUPS, previous + 1);
  const requiresReview = misses === MAX_AUTOMATIC_LOOKUPS;

  return {
    state: 'SUBMITTING',
    leaseUntil: requiresReview
      ? null
      : now + LOOKUP_DELAYS_MS[misses - 1],
    submissionLookupMisses: misses,
    lastErrorCode: requiresReview
      ? 'SUBMISSION_UNCONFIRMED'
      : 'SUBMISSION_LOOKUP_PENDING',
    lastError: requiresReview
      ? 'Submissão sem confirmação externa. Exige revisão antes de reenviar.'
      : 'Submissão externa ainda não localizada; nova consulta agendada.',
  };
}

/**
 * Authorize attaching a provider response to the original submission only.
 * This prevents late results from replacing a provider ID already recorded
 * by a cancellation worker or by a different attempt.
 */
export function canAttachSubmittedProviderJob(
  current: Pick<VideoProcessingJob,
    | 'state'
    | 'processingVersion'
    | 'attempts'
    | 'sourceStoragePath'
    | 'leaseUntil'
    | 'externalJobName'
  > | null,
  observed: Pick<VideoProcessingJob,
    'processingVersion' | 'attempts' | 'sourceStoragePath' | 'leaseUntil'
  >,
  providerJobName: string
): boolean {
  if (
    !current ||
    !providerJobName ||
    current.processingVersion !== observed.processingVersion ||
    current.attempts !== observed.attempts ||
    current.sourceStoragePath !== observed.sourceStoragePath ||
    (current.externalJobName !== null &&
      current.externalJobName !== providerJobName)
  ) {
    return false;
  }

  if (current.state === 'SUBMITTING') {
    return current.leaseUntil === observed.leaseUntil;
  }

  if (current.state === 'CANCEL_REQUESTED') {
    return true;
  }

  // A PROCESSING record without its external ID may be repaired only for
  // the exact same version/source. Once bound, late responses cannot replace it.
  return current.state === 'PROCESSING' && !current.externalJobName;
}

/**
 * Per-invocation, identifier-free observations. They never drive state transitions:
 * mutation results and version fences remain in the existing Firestore handlers.
 */
export type VideoWorkOutcome =
  | 'SUBMISSION_CONFIRMED' | 'SUBMISSION_UNCONFIRMED'
  | 'SUBMISSION_RETRY' | 'SUBMISSION_FAILED'
  | 'SUBMISSION_DEFERRED' | 'SUBMISSION_REPLACED'
  | 'RECOVERY_CONFIRMED' | 'RECOVERY_UNCONFIRMED'
  | 'RECOVERY_POLL_ERROR' | 'RECOVERY_REPLACED'
  | 'PROVIDER_POLL_ERROR' | 'PROVIDER_REVIEW'
  | 'PROVIDER_NONTERMINAL' | 'PROVIDER_SUCCEEDED_OBSERVED'
  | 'PROVIDER_FAILED_OBSERVED' | 'PROCESSING_REPLACED';

const OUTCOME_METRICS: Record<VideoWorkOutcome, string> = {
  SUBMISSION_CONFIRMED: 'submissionConfirmed',
  SUBMISSION_UNCONFIRMED: 'submissionUnconfirmed',
  SUBMISSION_RETRY: 'submissionRetryScheduled',
  SUBMISSION_FAILED: 'submissionFailed',
  SUBMISSION_DEFERRED: 'submissionDeferred',
  SUBMISSION_REPLACED: 'submissionReplaced',
  RECOVERY_CONFIRMED: 'recoveryConfirmed',
  RECOVERY_UNCONFIRMED: 'recoveryUnconfirmed',
  RECOVERY_POLL_ERROR: 'recoveryPollErrors',
  RECOVERY_REPLACED: 'recoveryReplaced',
  PROVIDER_POLL_ERROR: 'providerPollErrors',
  PROVIDER_REVIEW: 'providerReviewRequired',
  PROVIDER_NONTERMINAL: 'providerNonterminal',
  PROVIDER_SUCCEEDED_OBSERVED: 'providerSucceededObserved',
  PROVIDER_FAILED_OBSERVED: 'providerFailedObserved',
  PROCESSING_REPLACED: 'processingReplaced',
};

const ATTENTION_OUTCOMES: readonly VideoWorkOutcome[] = [
  'SUBMISSION_UNCONFIRMED', 'SUBMISSION_RETRY', 'SUBMISSION_FAILED',
  'SUBMISSION_DEFERRED', 'RECOVERY_UNCONFIRMED', 'RECOVERY_POLL_ERROR',
  'PROVIDER_POLL_ERROR', 'PROVIDER_REVIEW', 'PROVIDER_FAILED_OBSERVED',
];

export function createVideoWorkOutcomeCounter(): {
  observe: (outcome: VideoWorkOutcome) => void;
  metrics: () => Record<string, number>;
  needsAttention: () => boolean;
} {
  const counts = new Map<VideoWorkOutcome, number>();
  return {
    observe: (outcome) => counts.set(outcome, (counts.get(outcome) ?? 0) + 1),
    metrics: () => Object.fromEntries(
      Array.from(counts.entries()).map(([key, count]) => [OUTCOME_METRICS[key], count])
    ),
    needsAttention: () => ATTENTION_OUTCOMES.some(outcome => (counts.get(outcome) ?? 0) > 0),
  };
}

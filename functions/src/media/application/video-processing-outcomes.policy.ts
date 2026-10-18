/**
 * Per-invocation, identifier-free observations. They never drive state transitions:
 * mutation results and version fences remain in the existing Firestore handlers.
 */
export type VideoWorkOutcome =
  | 'SUBMISSION_CONFIRMED' | 'SUBMISSION_UNCONFIRMED'
  | 'SUBMISSION_RETRY' | 'SUBMISSION_FAILED'
  | 'SUBMISSION_DEFERRED' | 'SUBMISSION_REPLACED' | 'SUBMISSION_CANCEL_REQUESTED'
  | 'RECOVERY_CONFIRMED' | 'RECOVERY_UNCONFIRMED'
  | 'RECOVERY_POLL_ERROR' | 'RECOVERY_REPLACED' | 'RECOVERY_CANCEL_REQUESTED'
  | 'PROVIDER_POLL_ERROR' | 'PROVIDER_REVIEW'
  | 'PROVIDER_NONTERMINAL' | 'PROVIDER_NONTERMINAL_APPLIED'
  | 'PROVIDER_SUCCEEDED_OBSERVED' | 'PROVIDER_SUCCEEDED_APPLIED'
  | 'PROVIDER_FAILED_OBSERVED' | 'PROVIDER_FAILED_APPLIED'
  | 'PROVIDER_TERMINAL_CANCEL_REQUESTED' | 'PROCESSING_REPLACED'
  | 'PROCESSING_SKIPPED';

const OUTCOME_METRICS: Record<VideoWorkOutcome, string> = {
  SUBMISSION_CONFIRMED: 'submissionConfirmed',
  SUBMISSION_UNCONFIRMED: 'submissionUnconfirmed',
  SUBMISSION_RETRY: 'submissionRetryScheduled',
  SUBMISSION_FAILED: 'submissionFailed',
  SUBMISSION_DEFERRED: 'submissionDeferred',
  SUBMISSION_REPLACED: 'submissionReplaced',
  SUBMISSION_CANCEL_REQUESTED: 'submissionCancelRequested',
  RECOVERY_CONFIRMED: 'recoveryConfirmed',
  RECOVERY_UNCONFIRMED: 'recoveryUnconfirmed',
  RECOVERY_POLL_ERROR: 'recoveryPollErrors',
  RECOVERY_REPLACED: 'recoveryReplaced',
  RECOVERY_CANCEL_REQUESTED: 'recoveryCancelRequested',
  PROVIDER_POLL_ERROR: 'providerPollErrors',
  PROVIDER_REVIEW: 'providerReviewRequired',
  PROVIDER_NONTERMINAL: 'providerNonterminal',
  PROVIDER_NONTERMINAL_APPLIED: 'providerNonterminalApplied',
  PROVIDER_SUCCEEDED_OBSERVED: 'providerSucceededObserved',
  PROVIDER_SUCCEEDED_APPLIED: 'providerSucceededApplied',
  PROVIDER_FAILED_OBSERVED: 'providerFailedObserved',
  PROVIDER_FAILED_APPLIED: 'providerFailedApplied',
  PROVIDER_TERMINAL_CANCEL_REQUESTED: 'providerTerminalCancelRequested',
  PROCESSING_REPLACED: 'processingReplaced',
  PROCESSING_SKIPPED: 'processingSkipped',
};

const ATTENTION_OUTCOMES: readonly VideoWorkOutcome[] = [
  'SUBMISSION_UNCONFIRMED', 'SUBMISSION_RETRY', 'SUBMISSION_FAILED',
  'SUBMISSION_DEFERRED', 'RECOVERY_UNCONFIRMED', 'RECOVERY_POLL_ERROR',
  'PROVIDER_POLL_ERROR', 'PROVIDER_REVIEW', 'PROVIDER_FAILED_APPLIED',
];

/** The first counter is provider observation; the second is the committed result. */
export function terminalVideoWorkOutcomes(
  providerState: 'SUCCEEDED' | 'FAILED',
  disposition: 'APPLIED' | 'REPLACED' | 'CANCEL_REQUESTED' | 'SKIPPED'
): readonly [VideoWorkOutcome, VideoWorkOutcome] {
  const observed: VideoWorkOutcome = providerState === 'SUCCEEDED'
    ? 'PROVIDER_SUCCEEDED_OBSERVED' : 'PROVIDER_FAILED_OBSERVED';
  const committed: VideoWorkOutcome = disposition === 'APPLIED'
    ? providerState === 'SUCCEEDED' ? 'PROVIDER_SUCCEEDED_APPLIED' : 'PROVIDER_FAILED_APPLIED'
    : disposition === 'CANCEL_REQUESTED' ? 'PROVIDER_TERMINAL_CANCEL_REQUESTED'
      : 'PROCESSING_REPLACED';
  return [observed, committed];
}

export interface VideoWorkOutcomeCounter {
  observe: (outcome: VideoWorkOutcome) => void;
  metrics: () => Record<string, number>;
  needsAttention: () => boolean;
}

export function createVideoWorkOutcomeCounter(): VideoWorkOutcomeCounter {
  const counts = new Map<VideoWorkOutcome, number>();
  return {
    observe: (outcome) => counts.set(outcome, (counts.get(outcome) ?? 0) + 1),
    metrics: () => Object.fromEntries(
      Array.from(counts.entries()).map(([key, count]) => [OUTCOME_METRICS[key], count])
    ),
    needsAttention: () => ATTENTION_OUTCOMES.some(outcome => (counts.get(outcome) ?? 0) > 0),
  };
}

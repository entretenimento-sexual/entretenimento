// Advisory-only performance signal for the disposable Firestore Emulator.
// No Github API, no extra emulator executions, no private document identifiers.
// A single historical CI baseline is not evidence of multi-run stability.
export const REVOCATION_REFERENCE_MS = 202_487; // c13, 2026-10-18
export const REVOCATION_REVIEW_THRESHOLD_MS = 360_000; // operational review only

export function assessPhotoE2EPerformance(summary) {
  const complete = summary.revocationSuiteCompletedObserved === true
    && summary.revocationSuiteExpectedCases === 11
    && summary.transactionCasesObservedPassing === 11
    && summary.revocationTimedCases === 9
    && summary.revocationMaxAttempts >= 2
    && Number.isSafeInteger(summary.revocationSuiteWallMs)
    && summary.revocationSuiteWallMs >= 0;

  return {
    authority: 'ADVISORY_ONLY',
    evidence: complete ? 'COMPLETE_LOG_MARKERS' : 'INCOMPLETE_LOG_MARKERS',
    performanceSignal: !complete
      ? 'NOT_ASSESSED'
      : summary.revocationSuiteWallMs > REVOCATION_REVIEW_THRESHOLD_MS
        ? 'REVIEW_LATENCY'
        : 'NO_REGRESSION_SIGNAL',
    referenceMs: REVOCATION_REFERENCE_MS,
    reviewThresholdMs: REVOCATION_REVIEW_THRESHOLD_MS,
    // CI test process exit status, not warning count or duration, is authoritative.
    securityResult: 'NOT_INFERRED',
  };
}

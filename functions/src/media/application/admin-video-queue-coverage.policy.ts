/**
 * Read-only, per-page diagnostics for administrative Media queues.
 * No database reads, Transcoder requests, mutations or new index dependencies.
 * Document-ID cursors cannot guarantee a consistent global snapshot.
 */
export interface RecoveryQueueAuditCandidate {
  state: string;
  timestampEvidence: 'UPDATED' | 'CREATED_FALLBACK' | 'UNVERIFIED';
  requiresProviderReview: boolean;
  providerPollReviewRequired: boolean;
  requiresOperationalAttention: boolean;
  stale: boolean;
  unconfirmedSubmission: boolean;
}
export interface RecoveryQueuePageAudit {
  scope: 'PAGE_ONLY';
  observed: number;
  invalidDocuments: number;
  updatedTimestamp: number;
  createdFallback: number;
  unverifiedTimestamp: number;
  failed: number;
  stale: number;
  providerReview: number;
  providerPollReview: number;
  overdueCancellation: number;
  unconfirmedSubmission: number;
}
export interface TerminalQueueAuditCandidate {
  updatedAt: number;
  recheckable: boolean;
}
export interface TerminalQueuePageAudit {
  scope: 'PAGE_ONLY';
  observed: number;
  unverifiedTimestamp: number;
  blocked: number;
  recheckable: number;
}

export function auditRecoveryQueuePage(
  items: readonly RecoveryQueueAuditCandidate[],
  invalidDocuments: number
): RecoveryQueuePageAudit {
  const audit: RecoveryQueuePageAudit = {
    scope: 'PAGE_ONLY', observed: items.length, invalidDocuments,
    updatedTimestamp: 0, createdFallback: 0, unverifiedTimestamp: 0,
    failed: 0, stale: 0, providerReview: 0, providerPollReview: 0,
    overdueCancellation: 0, unconfirmedSubmission: 0,
  };
  for (const item of items) {
    if (item.timestampEvidence === 'UPDATED') audit.updatedTimestamp++;
    else if (item.timestampEvidence === 'CREATED_FALLBACK') audit.createdFallback++;
    else audit.unverifiedTimestamp++;
    if (item.state === 'FAILED') audit.failed++;
    if (item.stale) audit.stale++;
    if (item.requiresProviderReview) audit.providerReview++;
    if (item.providerPollReviewRequired) audit.providerPollReview++;
    if (item.requiresOperationalAttention) audit.overdueCancellation++;
    if (item.unconfirmedSubmission) audit.unconfirmedSubmission++;
  }
  return audit;
}

export function auditTerminalQueuePage(
  items: readonly TerminalQueueAuditCandidate[]
): TerminalQueuePageAudit {
  const audit: TerminalQueuePageAudit = {
    scope: 'PAGE_ONLY', observed: items.length,
    unverifiedTimestamp: 0, blocked: 0, recheckable: 0,
  };
  for (const item of items) {
    if (item.updatedAt === 0) audit.unverifiedTimestamp++;
    if (item.recheckable) audit.recheckable++;
    else audit.blocked++;
  }
  return audit;
}

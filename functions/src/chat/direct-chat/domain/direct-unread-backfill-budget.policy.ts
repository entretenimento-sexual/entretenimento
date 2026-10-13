/**
 * Conservative document-read estimate for ONE successful emulator backfill.
 * This is NOT a billing ceiling: index-entry reads, concurrent callers,
 * rejected attempts, and SDK behavior can increase actual Firestore charges.
 */
export const DIRECT_UNREAD_MAX_MESSAGES = 100;
export const DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS = 3;
export const DIRECT_UNREAD_MAX_ESTIMATED_READS = 33_000;
export const DIRECT_UNREAD_MAX_COMMITTED_WRITES = 400;

export function estimateDirectUnreadBackfillBudget(messageCount: number) {
  if (!Number.isSafeInteger(messageCount) ||
      messageCount < 1 || messageCount > DIRECT_UNREAD_MAX_MESSAGES) {
    throw new Error('Unread backfill requires 1..100 messages');
  }
  const n = messageCount;
  // Pre/post audits: each n+3 reads, with up to three attempts.
  // Preflight: n-message query, chat, two projections, up to 2n checkpoints,
  // plus at least two billed reads for empty checkpoint queries.
  // Each reconciliation attempt: n-message query, chat, message,
  // two projections and two per-message checkpoints = n+6 reads.
  const estimatedReadsNoRetry = n * n + 11 * n + 11;
  const estimatedReadsWithRetries = 3 * n * n + 27 * n + 23;
  const maxCommittedWrites = 4 * n;
  if (estimatedReadsWithRetries > DIRECT_UNREAD_MAX_ESTIMATED_READS ||
      maxCommittedWrites > DIRECT_UNREAD_MAX_COMMITTED_WRITES) {
    throw new Error('Unread backfill estimated budget exceeded');
  }
  return {
    messageCount: n,
    estimatedReadsNoRetry,
    estimatedReadsWithRetries,
    maxCommittedWrites,
    maxTransactionAttempts: DIRECT_UNREAD_MAX_TRANSACTION_ATTEMPTS,
    billingEstimateOnly: true,
  };
}

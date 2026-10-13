/**
 * Emulator journal decisions. A stale heartbeat is NOT proof of termination.
 * No automatic deletion is ever allowed for a RUNNING or malformed record.
 */
export const DIRECT_UNREAD_JOURNAL_STALE_MS = 2 * 60 * 60 * 1000;
export const DIRECT_UNREAD_JOURNAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type DirectUnreadJournalClassification =
  'RUNNING_RECENT' | 'RUNNING_STALE_UNKNOWN' | 'SUCCEEDED' | 'FAILED' | 'INVALID';

export function classifyDirectUnreadJournal(
  status: unknown, updatedAtMs: number | null,
  finishedAtMs: number | null, nowMs: number
): { classification: DirectUnreadJournalClassification; eligibleForPurge: boolean } {
  const validNow = Number.isFinite(nowMs);
  const validUpdated = updatedAtMs !== null && Number.isFinite(updatedAtMs) &&
    updatedAtMs >= 0 && updatedAtMs <= nowMs;
  if (!validNow || !validUpdated) {
    return { classification: 'INVALID', eligibleForPurge: false };
  }
  if (status === 'RUNNING') {
    return {
      classification: nowMs - updatedAtMs >= DIRECT_UNREAD_JOURNAL_STALE_MS ?
        'RUNNING_STALE_UNKNOWN' : 'RUNNING_RECENT',
      eligibleForPurge: false,
    };
  }
  const validFinished = finishedAtMs !== null && Number.isFinite(finishedAtMs) &&
    finishedAtMs >= updatedAtMs && finishedAtMs <= nowMs;
  if (!validFinished || (status !== 'SUCCEEDED' && status !== 'FAILED')) {
    return { classification: 'INVALID', eligibleForPurge: false };
  }
  return {
    classification: status,
    eligibleForPurge: nowMs - finishedAtMs >= DIRECT_UNREAD_JOURNAL_RETENTION_MS,
  };
}

const GROUPED_COMMUNITY_NOTIFICATION_TYPES = new Set([
  'community.comment.received',
  'community.comment.reply.received',
]);

export const MARK_ALL_NOTIFICATIONS_BATCH_SIZE = 250;

/** Never consume activity updated after the action's fixed cutoff. */
export function notificationEligibleForReadCutoff(updatedAtMs: number | null, createdAtMs: number | null, cutoffMs: number): boolean {
  if (createdAtMs === null || !Number.isFinite(createdAtMs) || createdAtMs > cutoffMs) return false;
  return updatedAtMs === null || (Number.isFinite(updatedAtMs) && updatedAtMs <= cutoffMs);
}
export const MARK_ALL_NOTIFICATIONS_MAX_BATCHES = 4;

export interface MarkAllNotificationsReadBatchPlan {
  writeCount: number;
  hasMore: boolean;
  shouldContinue: boolean;
}

export function shouldResetGroupedCommunityActivityCount(
  notificationType: unknown
): boolean {
  return GROUPED_COMMUNITY_NOTIFICATION_TYPES.has(
    String(notificationType ?? '').trim()
  );
}

export function resolveMarkAllNotificationsReadBatchPlan(input: {
  fetchedCount: unknown;
  batchNumber: unknown;
}): MarkAllNotificationsReadBatchPlan {
  const parsedFetchedCount = Math.trunc(Number(input.fetchedCount));
  const fetchedCount = Number.isFinite(parsedFetchedCount)
    ? Math.max(0, parsedFetchedCount)
    : 0;
  const parsedBatchNumber = Math.trunc(Number(input.batchNumber));
  const batchNumber = Number.isFinite(parsedBatchNumber)
    ? Math.max(1, parsedBatchNumber)
    : 1;
  const writeCount = Math.min(
    fetchedCount,
    MARK_ALL_NOTIFICATIONS_BATCH_SIZE
  );
  const hasMore = fetchedCount > MARK_ALL_NOTIFICATIONS_BATCH_SIZE;

  return {
    writeCount,
    hasMore,
    shouldContinue: hasMore && batchNumber < MARK_ALL_NOTIFICATIONS_MAX_BATCHES,
  };
}

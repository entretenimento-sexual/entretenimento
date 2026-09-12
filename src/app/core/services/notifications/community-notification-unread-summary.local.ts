export interface CommunityUnreadSummaryLike {
  readonly communityId: string;
  readonly unreadCount: number;
  readonly priorityUnreadCount: number;
  readonly hasPriorityUnread: boolean;
}

function normalizeCommunityId(value: unknown): string {
  return String(value ?? '').trim();
}

function hasSocialUnread(summary: CommunityUnreadSummaryLike): boolean {
  return summary.unreadCount > summary.priorityUnreadCount;
}

export function applyCommunitySocialUnreadSuppressions<
  T extends CommunityUnreadSummaryLike,
>(
  summaries: readonly T[],
  suppressedCommunityIds: ReadonlySet<string>
): readonly T[] {
  if (suppressedCommunityIds.size === 0) return summaries;

  return summaries.flatMap((summary) => {
    if (!suppressedCommunityIds.has(summary.communityId)) return [summary];

    const priorityUnreadCount = Math.min(
      summary.unreadCount,
      summary.priorityUnreadCount
    );
    if (priorityUnreadCount <= 0) return [];

    if (
      summary.unreadCount === priorityUnreadCount
      && summary.hasPriorityUnread
    ) {
      return [summary];
    }

    return [{
      ...summary,
      unreadCount: priorityUnreadCount,
      priorityUnreadCount,
      hasPriorityUnread: true,
    } as T];
  });
}

export function reconcileCommunitySocialUnreadSuppressions<
  T extends CommunityUnreadSummaryLike,
>(
  summaries: readonly T[],
  suppressedCommunityIds: ReadonlySet<string>
): ReadonlySet<string> {
  if (suppressedCommunityIds.size === 0) return suppressedCommunityIds;

  const byCommunityId = new Map(
    summaries.map((summary) => [summary.communityId, summary] as const)
  );
  const remaining = new Set<string>();

  for (const rawCommunityId of suppressedCommunityIds) {
    const communityId = normalizeCommunityId(rawCommunityId);
    if (!communityId) continue;

    const summary = byCommunityId.get(communityId);
    if (summary && hasSocialUnread(summary)) {
      remaining.add(communityId);
    }
  }

  return remaining;
}

export function shouldSuppressCommunitySocialUnreadLocally<
  T extends CommunityUnreadSummaryLike,
>(summaries: readonly T[], communityIdValue: unknown): boolean {
  const communityId = normalizeCommunityId(communityIdValue);
  if (!communityId) return false;

  const summary = summaries.find((item) => item.communityId === communityId);
  return summary ? hasSocialUnread(summary) : false;
}

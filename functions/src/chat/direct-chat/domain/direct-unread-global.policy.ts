/** Shadow aggregate only: never an authorization or a complete user total. */
export const MAX_SHADOW_UNREAD_CHATS = 100;

export interface ShadowUnreadAggregate {
  version: 1;
  participantUid: string;
  projectedChatCount: number;
  projectedUnreadCount: number;
  coverage: 'UNVERIFIED';
}

export function buildShadowUnreadAggregate(
  participantUid: string,
  rows: readonly { id: string; data: Record<string, unknown> }[]
): ShadowUnreadAggregate {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(participantUid) ||
      rows.length > MAX_SHADOW_UNREAD_CHATS) {
    throw new Error('Invalid shadow unread aggregate scope');
  }
  const seen = new Set<string>();
  let total = 0;
  for (const row of rows) {
    const count = row.data.unreadCount;
    if (!row.id || seen.has(row.id) || row.data.version !== 1 ||
        row.data.chatId !== row.id || row.data.participantUid !== participantUid ||
        typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 ||
        !Number.isSafeInteger(total + count)) {
      throw new Error('Invalid shadow unread projection');
    }
    seen.add(row.id);
    total += count;
  }
  return {
    version: 1, participantUid, projectedChatCount: seen.size,
    projectedUnreadCount: total, coverage: 'UNVERIFIED',
  };
}

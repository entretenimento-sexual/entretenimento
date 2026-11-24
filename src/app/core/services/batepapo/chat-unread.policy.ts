// Firestore receipts are authoritative. A missing legacy alias is accepted;
// conflicting aliases, foreign senders and tombstones never contribute.
export function isDirectMessageUnreadFor(
  data: Record<string, unknown>, ownerUid: string, peerUid: string
): boolean {
  const sender = data['senderId'] === undefined ? data['senderUid'] : data['senderId'];
  return !!ownerUid && !!peerUid && ownerUid !== peerUid &&
    sender === peerUid &&
    (data['senderUid'] === undefined || data['senderUid'] === sender) &&
    (data['recipientUid'] === undefined || data['recipientUid'] === ownerUid) &&
    data['deleted'] !== true &&
    (data['status'] === 'sent' || data['status'] === 'delivered');
}

export interface DirectUnreadState {
  readonly ownerUid: string | null;
  readonly counts: ReadonlyMap<string, number>;
}

export function totalDirectUnread(state: DirectUnreadState): number {
  return Array.from(state.counts.values()).reduce((sum, count) => sum + count, 0);
}

/** Suppress only identical owner-scoped counts, never authorization changes. */
export function sameDirectUnreadState(a: DirectUnreadState, b: DirectUnreadState): boolean {
  if (a.ownerUid !== b.ownerUid || a.counts.size !== b.counts.size) return false;
  for (const [id, count] of a.counts) if (b.counts.get(id) !== count) return false;
  return true;
}

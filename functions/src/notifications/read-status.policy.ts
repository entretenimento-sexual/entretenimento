const GROUPED_COMMUNITY_NOTIFICATION_TYPES = new Set([
  'community.comment.received',
  'community.comment.reply.received',
]);

export function shouldResetGroupedCommunityActivityCount(
  notificationType: unknown
): boolean {
  return GROUPED_COMMUNITY_NOTIFICATION_TYPES.has(
    String(notificationType ?? '').trim()
  );
}

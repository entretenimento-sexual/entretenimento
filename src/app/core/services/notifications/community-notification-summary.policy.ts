import type {
  IAppNotification,
  ICommunityNotificationSummary,
} from 'src/app/core/interfaces/app-notification.interface';

function notificationOrderValue(notification: IAppNotification): number {
  return notification.createdAt ?? notification.updatedAt ?? 0;
}

export function isCommunityPriorityNotification(
  notification: IAppNotification
): boolean {
  return notification.type === 'community.content.moderated'
    || notification.actionRequired === true;
}

export function buildCommunityNotificationSummaries(
  notifications: readonly IAppNotification[]
): ICommunityNotificationSummary[] {
  const summaries = new Map<string, ICommunityNotificationSummary>();

  for (const notification of notifications) {
    const communityId = String(notification.communityId ?? '').trim();
    if (!communityId) continue;

    const existing = summaries.get(communityId);
    const unread = notification.readAt == null;
    const priorityUnread = unread && isCommunityPriorityNotification(notification);

    if (!existing) {
      summaries.set(communityId, {
        communityId,
        latestNotification: notification,
        unreadCount: unread ? 1 : 0,
        hasPriorityUnread: priorityUnread,
      });
      continue;
    }

    if (
      notificationOrderValue(notification)
      > notificationOrderValue(existing.latestNotification)
    ) {
      existing.latestNotification = notification;
    }

    if (unread) {
      existing.unreadCount += 1;
    }

    existing.hasPriorityUnread ||= priorityUnread;
  }

  return Array.from(summaries.values()).sort(
    (left, right) =>
      notificationOrderValue(right.latestNotification)
      - notificationOrderValue(left.latestNotification)
  );
}

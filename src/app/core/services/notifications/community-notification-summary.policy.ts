import type {
  IAppNotification,
  ICommunityNotificationSummary,
} from 'src/app/core/interfaces/app-notification.interface';

interface CommunityNotificationAccumulator {
  summary: ICommunityNotificationSummary;
  latestUnreadNotification: IAppNotification | null;
  latestPriorityUnreadNotification: IAppNotification | null;
}

function notificationOrderValue(notification: IAppNotification): number {
  return notification.createdAt ?? notification.updatedAt ?? 0;
}

function newestNotification(
  current: IAppNotification | null,
  candidate: IAppNotification
): IAppNotification {
  if (!current) {
    return candidate;
  }

  return notificationOrderValue(candidate) > notificationOrderValue(current)
    ? candidate
    : current;
}

export function communityNotificationActivityCount(
  notification: IAppNotification
): number {
  const parsed = Math.trunc(Number(notification.activityCount));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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
  const accumulators = new Map<string, CommunityNotificationAccumulator>();

  for (const notification of notifications) {
    const communityId = String(notification.communityId ?? '').trim();
    if (!communityId) continue;

    const existing = accumulators.get(communityId);
    const unread = notification.readAt == null;
    const unreadActivityCount = unread
      ? communityNotificationActivityCount(notification)
      : 0;
    const priorityUnread = unread && isCommunityPriorityNotification(notification);

    if (!existing) {
      accumulators.set(communityId, {
        summary: {
          communityId,
          latestNotification: notification,
          attentionNotification: notification,
          unreadCount: unreadActivityCount,
          hasPriorityUnread: priorityUnread,
        },
        latestUnreadNotification: unread ? notification : null,
        latestPriorityUnreadNotification: priorityUnread ? notification : null,
      });
      continue;
    }

    if (
      notificationOrderValue(notification)
      > notificationOrderValue(existing.summary.latestNotification)
    ) {
      existing.summary.latestNotification = notification;
    }

    if (unread) {
      existing.latestUnreadNotification = newestNotification(
        existing.latestUnreadNotification,
        notification
      );
    }

    if (priorityUnread) {
      existing.latestPriorityUnreadNotification = newestNotification(
        existing.latestPriorityUnreadNotification,
        notification
      );
    }

    existing.summary.unreadCount += unreadActivityCount;
    existing.summary.hasPriorityUnread ||= priorityUnread;
  }

  return Array.from(accumulators.values())
    .map((accumulator) => ({
      ...accumulator.summary,
      attentionNotification:
        accumulator.latestPriorityUnreadNotification
        ?? accumulator.latestUnreadNotification
        ?? accumulator.summary.latestNotification,
    }))
    .sort(
      (left, right) =>
        notificationOrderValue(right.latestNotification)
        - notificationOrderValue(left.latestNotification)
    );
}

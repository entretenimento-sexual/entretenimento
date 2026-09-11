import { AppNotificationService } from './app-notification.service';
import { CommunityNotificationUnreadSummaryService } from './community-notification-unread-summary.service';

type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

const recentWindowExposesAggregateCommunityUnread: HasKey<
  AppNotificationService,
  'currentUserCommunityUnreadCount$'
> = false;

const aggregateProjectionExposesCommunityUnread: HasKey<
  CommunityNotificationUnreadSummaryService,
  'currentUserUnreadCount$'
> = true;

describe('Community notification unread authority contract', () => {
  it('keeps aggregate unread totals out of the recent notification window', () => {
    expect(recentWindowExposesAggregateCommunityUnread).toBe(false);
    expect(aggregateProjectionExposesCommunityUnread).toBe(true);
  });
});

export type AppNotificationType =
  | 'user_intent_status.published'
  | 'user_intent_status.compatible'
  | 'compliance.terms.update_required'
  | 'compliance.terms.updated'
  | 'compliance.violation.suspected'
  | 'compliance.violation.response_received'
  | 'compliance.violation.resolved'
  | 'compliance.action.taken'
  | 'community.comment.received'
  | 'community.comment.reply.received'
  | 'community.content.moderated'
  | 'system'
  | 'social'
  | 'chat'
  | 'billing';

export type AppNotificationModerationTarget = 'comment' | 'reply' | 'post';

export interface IAppNotification {
  id: string;
  userId: string;
  type: AppNotificationType;
  title: string;
  body: string;
  route: string | null;
  caseId?: string | null;
  legalVersion?: string | null;
  actionRequired?: boolean | null;
  responseDueAt?: number | null;
  policySection?: string | null;
  communityId?: string | null;
  postId?: string | null;
  commentId?: string | null;
  replyToCommentId?: string | null;
  replyId?: string | null;
  actorUid?: string | null;
  activityCount?: number | null;
  moderationTarget?: AppNotificationModerationTarget | null;
  readAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface IAppNotificationListVm {
  loading: boolean;
  items: IAppNotification[];
  unreadCount: number;
}

export interface ICommunityNotificationSummary {
  communityId: string;
  latestNotification: IAppNotification;
  unreadCount: number;
  hasPriorityUnread: boolean;
}

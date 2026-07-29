export type AppNotificationType =
  | 'user_intent_status.published'
  | 'user_intent_status.compatible'
  | 'compliance.terms.updated'
  | 'compliance.violation.suspected'
  | 'compliance.violation.response_received'
  | 'compliance.violation.resolved'
  | 'compliance.action.taken'
  | 'system'
  | 'social'
  | 'chat'
  | 'billing';

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
  readAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface IAppNotificationListVm {
  loading: boolean;
  items: IAppNotification[];
  unreadCount: number;
}

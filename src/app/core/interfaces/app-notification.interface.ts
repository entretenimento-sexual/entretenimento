export type AppNotificationType =
  | 'user_intent_status.published'
  | 'user_intent_status.compatible'
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
  readAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface IAppNotificationListVm {
  loading: boolean;
  items: IAppNotification[];
  unreadCount: number;
}

import type {
  AppNotificationType,
  IAppNotification,
} from 'src/app/core/interfaces/app-notification.interface';

export type CommunityAppNotificationType =
  Extract<AppNotificationType, `community.${string}`>;

export type CommunityNotificationCategory =
  | 'social'
  | 'membership'
  | 'management'
  | 'access'
  | 'moderation';

export interface CommunityNotificationMatrixEntry {
  readonly category: CommunityNotificationCategory;
  readonly priority: boolean;
  readonly backgroundProjection: 'aggregate_summary';
  readonly foregroundMode: 'detailed_realtime';
}

function entry(
  category: CommunityNotificationCategory,
  priority: boolean
): CommunityNotificationMatrixEntry {
  return Object.freeze({
    category,
    priority,
    backgroundProjection: 'aggregate_summary',
    foregroundMode: 'detailed_realtime',
  });
}

/**
 * Matriz transversal de notificação de Comunidades.
 *
 * O `satisfies Record<CommunityAppNotificationType, ...>` torna a cobertura
 * exaustiva em compile-time: adicionar um novo AppNotificationType de Comunidade
 * sem decidir sua categoria/prioridade quebra o build.
 */
export const COMMUNITY_NOTIFICATION_MATRIX = Object.freeze({
  'community.comment.received': entry('social', false),
  'community.comment.reply.received': entry('social', false),
  'community.post.reply.received': entry('social', false),
  'community.post.reaction.received': entry('social', false),
  'community.membership.approved': entry('membership', false),
  'community.membership.rejected': entry('membership', false),
  'community.membership.requested': entry('management', true),
  'community.membership.removed': entry('access', true),
  'community.membership.blocked': entry('access', true),
  'community.membership.unblocked': entry('access', false),
  'community.invite.accepted': entry('membership', false),
  'community.invite.declined': entry('membership', false),
  'community.content.moderated': entry('moderation', true),
} satisfies Record<CommunityAppNotificationType, CommunityNotificationMatrixEntry>);

export function isCommunityNotificationType(
  value: AppNotificationType | string | null | undefined
): value is CommunityAppNotificationType {
  return Object.prototype.hasOwnProperty.call(
    COMMUNITY_NOTIFICATION_MATRIX,
    String(value ?? '')
  );
}

export function communityNotificationMatrixEntry(
  value: AppNotificationType | string | null | undefined
): CommunityNotificationMatrixEntry | null {
  return isCommunityNotificationType(value)
    ? COMMUNITY_NOTIFICATION_MATRIX[value]
    : null;
}

export function isCommunityNotificationPriority(
  notification: Pick<IAppNotification, 'type' | 'actionRequired'>
): boolean {
  const policy = communityNotificationMatrixEntry(notification.type);
  return !!policy && (policy.priority || notification.actionRequired === true);
}

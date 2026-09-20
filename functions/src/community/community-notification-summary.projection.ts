// functions/src/community/community-notification-summary.projection.ts
// -----------------------------------------------------------------------------
// COMMUNITY NOTIFICATION SUMMARY PROJECTION
// -----------------------------------------------------------------------------
// Matriz canônica da projeção agregada multi-Comunidade.
//
// Toda notificação de Comunidade entra no resumo privado por usuário/Comunidade.
// Somente atividade social depende do ciclo atual de membership, porque respostas
// antigas não podem reaparecer depois de saída/reentrada. Eventos de acesso,
// gestão e moderação precisam sobreviver mesmo quando o membership deixou de ser
// ativo, pois justamente podem comunicar remoção, bloqueio ou rejeição.
// -----------------------------------------------------------------------------

const MAX_ACTIVITY_COUNT = 1_000_000_000;

export const COMMUNITY_NOTIFICATION_SUMMARY_MATRIX = Object.freeze({
  'community.comment.received': {
    category: 'social',
    priority: false,
    requiresActiveMembershipCycle: true,
  },
  'community.comment.reply.received': {
    category: 'social',
    priority: false,
    requiresActiveMembershipCycle: true,
  },
  'community.post.reply.received': {
    category: 'social',
    priority: false,
    requiresActiveMembershipCycle: true,
  },
  'community.post.reaction.received': {
    category: 'social',
    priority: false,
    requiresActiveMembershipCycle: true,
  },
  'community.membership.approved': {
    category: 'membership',
    priority: false,
    requiresActiveMembershipCycle: false,
  },
  'community.membership.rejected': {
    category: 'membership',
    priority: false,
    requiresActiveMembershipCycle: false,
  },
  'community.membership.requested': {
    category: 'management',
    priority: true,
    requiresActiveMembershipCycle: false,
  },
  'community.membership.removed': {
    category: 'access',
    priority: true,
    requiresActiveMembershipCycle: false,
  },
  'community.membership.blocked': {
    category: 'access',
    priority: true,
    requiresActiveMembershipCycle: false,
  },
  'community.membership.unblocked': {
    category: 'access',
    priority: false,
    requiresActiveMembershipCycle: false,
  },
  'community.invite.accepted': {
    category: 'membership',
    priority: false,
    requiresActiveMembershipCycle: false,
  },
  'community.invite.declined': {
    category: 'membership',
    priority: false,
    requiresActiveMembershipCycle: false,
  },
  'community.content.moderated': {
    category: 'moderation',
    priority: true,
    requiresActiveMembershipCycle: false,
  },
} as const);

type CommunityNotificationSummaryType =
  keyof typeof COMMUNITY_NOTIFICATION_SUMMARY_MATRIX;

export interface CommunityNotificationSummaryContribution {
  userId: string;
  communityId: string;
  unreadCount: number;
  priorityUnreadCount: number;
}

function normalizeId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeActivityCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(parsed, MAX_ACTIVITY_COUNT);
}

function isUnread(raw: Record<string, unknown>): boolean {
  return raw['readAt'] == null;
}

function notificationPolicy(
  value: unknown
): (typeof COMMUNITY_NOTIFICATION_SUMMARY_MATRIX)[CommunityNotificationSummaryType] | null {
  const type = normalizeId(value) as CommunityNotificationSummaryType;
  return COMMUNITY_NOTIFICATION_SUMMARY_MATRIX[type] ?? null;
}

function isPriority(raw: Record<string, unknown>, type: unknown): boolean {
  const policy = notificationPolicy(type);
  return policy?.priority === true || raw['actionRequired'] === true;
}

export function isCommunitySocialNotificationType(value: unknown): boolean {
  return notificationPolicy(value)?.requiresActiveMembershipCycle === true;
}

export function projectCommunityNotificationSummaryContribution(
  raw: FirebaseFirestore.DocumentData | undefined
): CommunityNotificationSummaryContribution | null {
  if (!raw) return null;

  const type = normalizeId(raw['type']);
  const userId = normalizeId(raw['userId']);
  const communityId = normalizeId(raw['communityId']);

  if (
    !notificationPolicy(type)
    || !userId
    || !communityId
    || !isUnread(raw)
  ) {
    return null;
  }

  const unreadCount = normalizeActivityCount(raw['activityCount']);

  return {
    userId,
    communityId,
    unreadCount,
    priorityUnreadCount: isPriority(raw, type) ? unreadCount : 0,
  };
}

export function normalizeCommunityNotificationSummaryCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_ACTIVITY_COUNT);
}

export function sameCommunityNotificationSummaryContribution(
  left: CommunityNotificationSummaryContribution | null,
  right: CommunityNotificationSummaryContribution | null
): boolean {
  if (!left || !right) return left === right;

  return left.userId === right.userId
    && left.communityId === right.communityId
    && left.unreadCount === right.unreadCount
    && left.priorityUnreadCount === right.priorityUnreadCount;
}

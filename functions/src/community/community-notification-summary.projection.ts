// functions/src/community/community-notification-summary.projection.ts
// -----------------------------------------------------------------------------
// COMMUNITY NOTIFICATION SUMMARY PROJECTION
// -----------------------------------------------------------------------------
// Converte uma notificação canônica em contribuição mínima para o resumo
// multi-Comunidade do próprio usuário. Não replica membership, role ou metadados
// da Comunidade: esses dados continuam nas respectivas fontes canônicas.
// -----------------------------------------------------------------------------

const MAX_ACTIVITY_COUNT = 1_000_000_000;

const COMMUNITY_SOCIAL_NOTIFICATION_TYPES = new Set([
  'community.comment.received',
  'community.comment.reply.received',
]);

const COMMUNITY_NOTIFICATION_TYPES = new Set([
  ...COMMUNITY_SOCIAL_NOTIFICATION_TYPES,
  'community.content.moderated',
]);

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

function isPriority(raw: Record<string, unknown>, type: string): boolean {
  return type === 'community.content.moderated' || raw['actionRequired'] === true;
}

export function isCommunitySocialNotificationType(value: unknown): boolean {
  return COMMUNITY_SOCIAL_NOTIFICATION_TYPES.has(normalizeId(value));
}

export function projectCommunityNotificationSummaryContribution(
  raw: FirebaseFirestore.DocumentData | undefined
): CommunityNotificationSummaryContribution | null {
  if (!raw) return null;

  const type = normalizeId(raw['type']);
  const userId = normalizeId(raw['userId']);
  const communityId = normalizeId(raw['communityId']);

  if (
    !COMMUNITY_NOTIFICATION_TYPES.has(type)
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

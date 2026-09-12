// -----------------------------------------------------------------------------
// COMMUNITY NOTIFICATION POLICY
// -----------------------------------------------------------------------------
// Centraliza elegibilidade, agrupamento e texto seguro. A preferência global de
// `communities` controla somente o push externo em `sendNotification`; atividade
// in-app continua sendo persistida para manter a Central consistente.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

const COMMENT_GROUP_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_ACTIVITY_COUNT = 1_000_000_000;
const COMMUNITY_SOCIAL_ACTIVITY_NOTIFICATION_TYPES = new Set([
  'community.comment.received',
  'community.comment.reply.received',
]);

export type CommunityModerationTarget = 'comment' | 'reply' | 'post';

export interface CommunityNotificationUser {
  uid?: unknown;
  accountStatus?: unknown;
  interactionBlocked?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
  profileCompleted?: unknown;
}

export interface CommunityNotificationMembership {
  status?: unknown;
  joinedAt?: unknown;
}

export interface CommunityNotificationPreferences {
  notificationPreferences?: {
    communities?: unknown;
  };
}

export interface CommunityCommentNotificationCopy {
  title: string;
  body: string;
  activityCount: number;
}

function normalizeText(value: unknown, maxLength: number): string {
  return Array.from(String(value ?? ''))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127 ? character : ' ';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), MAX_ACTIVITY_COUNT)
    : 0;
}

export function normalizeCommunityNotificationTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  }

  if (value && typeof value === 'object') {
    const source = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof source.toMillis === 'function') {
      const time = Number(source.toMillis());
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }

    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      const time = seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }
  }

  return null;
}

function stableId(prefix: string, parts: string[]): string {
  const digest = createHash('sha256')
    .update(parts.join('\u001f'))
    .digest('hex')
    .slice(0, 40);
  return `${prefix}_${digest}`;
}

/**
 * @deprecated A preferência global de Comunidades é uma preferência de push e
 * não deve decidir persistência in-app. Mantido temporariamente para preservar
 * a nomenclatura dos consumidores enquanto a leitura redundante é removida.
 */
export function allowsCommunityActivityNotifications(
  _preferences: CommunityNotificationPreferences | undefined
): boolean {
  return true;
}

export function isCommunitySocialActivityNotificationType(type: unknown): boolean {
  return COMMUNITY_SOCIAL_ACTIVITY_NOTIFICATION_TYPES.has(
    String(type ?? '').trim()
  );
}

export function isCommunityNotificationInCurrentMembershipCycle(
  membership: CommunityNotificationMembership | undefined,
  notificationCreatedAt: unknown
): boolean {
  if (String(membership?.status ?? '').trim() !== 'active') return false;

  const joinedAtMs = normalizeCommunityNotificationTimestampMs(membership?.joinedAt);
  const notificationCreatedAtMs = normalizeCommunityNotificationTimestampMs(
    notificationCreatedAt
  );

  return joinedAtMs !== null
    && notificationCreatedAtMs !== null
    && notificationCreatedAtMs >= joinedAtMs;
}

export function canReceiveCommunityActivityNotification(
  user: CommunityNotificationUser | undefined,
  recipientUid: string,
  actorUid: string,
  membership: CommunityNotificationMembership | undefined
): boolean {
  if (!recipientUid || recipientUid === actorUid || user?.uid !== recipientUid) {
    return false;
  }

  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();

  return accountStatus === 'active'
    && user.profileCompleted === true
    && user.interactionBlocked !== true
    && user.accountLocked !== true
    && user.loginAllowed !== false
    && String(membership?.status ?? '').trim() === 'active'
    && normalizeCommunityNotificationTimestampMs(membership?.joinedAt) !== null;
}

export function canReceiveCommunityEssentialNotification(
  user: CommunityNotificationUser | undefined,
  recipientUid: string,
  actorUid: string
): boolean {
  if (!recipientUid || recipientUid === actorUid || user?.uid !== recipientUid) {
    return false;
  }

  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();

  return accountStatus !== 'deleted' && user.loginAllowed !== false;
}

export function buildCommunityCommentNotificationId(
  communityId: string,
  postId: string,
  recipientUid: string,
  nowMs: number,
  membershipJoinedAtMs?: number | null
): string {
  const window = Math.floor(Math.max(0, nowMs) / COMMENT_GROUP_WINDOW_MS);
  return stableId('community_comments', [
    communityId,
    postId,
    recipientUid,
    String(window),
    String(membershipJoinedAtMs ?? 0),
  ]);
}

export function buildCommunityReplyNotificationId(
  communityId: string,
  postId: string,
  commentId: string,
  recipientUid: string,
  nowMs: number,
  membershipJoinedAtMs?: number | null
): string {
  const window = Math.floor(Math.max(0, nowMs) / COMMENT_GROUP_WINDOW_MS);
  return stableId('community_replies', [
    communityId,
    postId,
    commentId,
    recipientUid,
    String(window),
    String(membershipJoinedAtMs ?? 0),
  ]);
}

export function buildCommunityModerationNotificationId(
  target: CommunityModerationTarget,
  operationId: string,
  recipientUid: string
): string {
  return stableId('community_moderation', [target, operationId, recipientUid]);
}

export function buildCommunityCommentNotificationCopy(input: {
  existingActivityCount: unknown;
  actorLabel: unknown;
  communityName: unknown;
}): CommunityCommentNotificationCopy {
  const activityCount = Math.min(
    normalizeCount(input.existingActivityCount) + 1,
    MAX_ACTIVITY_COUNT
  );
  const communityName = normalizeText(input.communityName, 60) || 'sua Comunidade';

  if (activityCount === 1) {
    const actorLabel = normalizeText(input.actorLabel, 40) || 'Alguém';
    return {
      title: 'Nova mensagem na conversa',
      body: `${actorLabel} entrou na conversa da sua publicação em ${communityName}.`,
      activityCount,
    };
  }

  return {
    title: `${activityCount} novas mensagens`,
    body: `A conversa da sua publicação em ${communityName} recebeu ${activityCount} novas mensagens.`,
    activityCount,
  };
}

export function buildCommunityReplyNotificationCopy(input: {
  existingActivityCount: unknown;
  actorLabel: unknown;
  communityName: unknown;
}): CommunityCommentNotificationCopy {
  const activityCount = Math.min(
    normalizeCount(input.existingActivityCount) + 1,
    MAX_ACTIVITY_COUNT
  );
  const communityName = normalizeText(input.communityName, 60) || 'sua Comunidade';

  if (activityCount === 1) {
    const actorLabel = normalizeText(input.actorLabel, 40) || 'Alguém';
    return {
      title: 'Nova resposta',
      body: `${actorLabel} respondeu à sua mensagem em ${communityName}.`,
      activityCount,
    };
  }

  return {
    title: `${activityCount} novas respostas`,
    body: `Sua mensagem em ${communityName} recebeu ${activityCount} novas respostas.`,
    activityCount,
  };
}

export function buildCommunityModerationNotificationCopy(input: {
  target: CommunityModerationTarget;
  communityName: unknown;
}): { title: string; body: string } {
  const communityName = normalizeText(input.communityName, 60) || 'uma Comunidade';
  const body = input.target === 'post'
    ? `Uma publicação sua foi removida em ${communityName}. Consulte as regras da Comunidade.`
    : input.target === 'reply'
      ? `Uma resposta legada sua foi removida em ${communityName}. Consulte as regras da Comunidade.`
      : `Uma mensagem sua foi removida da conversa em ${communityName}. Consulte as regras da Comunidade.`;

  return {
    title: 'Conteúdo moderado',
    body,
  };
}

export function buildCommunityNotificationRoute(communityId: string): string {
  return `/dashboard/comunidades/${encodeURIComponent(communityId)}`;
}
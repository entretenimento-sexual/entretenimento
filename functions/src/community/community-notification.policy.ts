// -----------------------------------------------------------------------------
// COMMUNITY NOTIFICATION POLICY
// -----------------------------------------------------------------------------
// Centraliza preferências, elegibilidade, agrupamento e texto seguro. O backend
// continua responsável por decidir quando uma notificação pode ser criada.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

const COMMENT_GROUP_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_ACTIVITY_COUNT = 1_000_000_000;

export type CommunityModerationTarget = 'comment' | 'reply' | 'post';

export interface CommunityNotificationUser {
  uid?: unknown;
  accountStatus?: unknown;
  interactionBlocked?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
  profileCompleted?: unknown;
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

function stableId(prefix: string, parts: string[]): string {
  const digest = createHash('sha256')
    .update(parts.join('\u001f'))
    .digest('hex')
    .slice(0, 40);
  return `${prefix}_${digest}`;
}

export function allowsCommunityActivityNotifications(
  preferences: CommunityNotificationPreferences | undefined
): boolean {
  return preferences?.notificationPreferences?.communities !== false;
}

export function canReceiveCommunityActivityNotification(
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

  return accountStatus === 'active'
    && user.profileCompleted === true
    && user.interactionBlocked !== true
    && user.accountLocked !== true
    && user.loginAllowed !== false;
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
  nowMs: number
): string {
  const window = Math.floor(Math.max(0, nowMs) / COMMENT_GROUP_WINDOW_MS);
  return stableId('community_comments', [
    communityId,
    postId,
    recipientUid,
    String(window),
  ]);
}

export function buildCommunityReplyNotificationId(
  communityId: string,
  postId: string,
  commentId: string,
  recipientUid: string,
  nowMs: number
): string {
  const window = Math.floor(Math.max(0, nowMs) / COMMENT_GROUP_WINDOW_MS);
  return stableId('community_replies', [
    communityId,
    postId,
    commentId,
    recipientUid,
    String(window),
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

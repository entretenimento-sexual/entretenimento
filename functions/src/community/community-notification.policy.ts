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

export type CommunityModerationTarget = 'comment' | 'reply' | 'post';
export type CommunityMembershipReviewOutcome = 'approved' | 'rejected';
export type CommunityMemberLifecycleNotificationAction =
  | 'remove'
  | 'block'
  | 'unblock';
export type CommunityInviteNotificationOutcome = 'accepted' | 'declined';

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
  membershipCycleStartedAtMs: number,
  nowMs: number
): string {
  const window = Math.floor(Math.max(0, nowMs) / COMMENT_GROUP_WINDOW_MS);
  return stableId('community_comments', [
    communityId,
    postId,
    recipientUid,
    String(membershipCycleStartedAtMs),
    String(window),
  ]);
}

export function buildCommunityReplyNotificationId(
  communityId: string,
  postId: string,
  commentId: string,
  recipientUid: string,
  membershipCycleStartedAtMs: number,
  nowMs: number
): string {
  const window = Math.floor(Math.max(0, nowMs) / COMMENT_GROUP_WINDOW_MS);
  return stableId('community_replies', [
    communityId,
    postId,
    commentId,
    recipientUid,
    String(membershipCycleStartedAtMs),
    String(window),
  ]);
}

export function buildCommunityPostReplyNotificationId(
  communityId: string,
  originalPostId: string,
  recipientUid: string,
  membershipCycleStartedAtMs: number,
  nowMs: number
): string {
  const window = Math.floor(Math.max(0, nowMs) / COMMENT_GROUP_WINDOW_MS);
  return stableId('community_post_replies', [
    communityId,
    originalPostId,
    recipientUid,
    String(membershipCycleStartedAtMs),
    String(window),
  ]);
}

export function buildCommunityMembershipRequestNotificationId(
  communityId: string,
  memberId: string,
  requestCycleStartedAtMs: number
): string {
  return stableId('community_membership_request', [
    communityId,
    memberId,
    String(Math.max(0, Math.trunc(requestCycleStartedAtMs))),
  ]);
}

export function buildCommunityMembershipRequestNotificationCopy(input: {
  communityName: unknown;
}): { title: string; body: string } {
  const communityName = normalizeText(input.communityName, 60) || 'sua Comunidade';

  return {
    title: 'Novo pedido de entrada',
    body: `Há um novo pedido para entrar em ${communityName}.`,
  };
}

export function isCommunityMembershipRequestNotificationForReview(
  raw: unknown,
  communityId: string,
  memberId: string
): boolean {
  const notification = (raw ?? {}) as Record<string, unknown>;

  return normalizeText(notification['type'], 80)
      === 'community.membership.requested'
    && normalizeText(notification['communityId'], 128) === communityId
    && normalizeText(notification['actorUid'], 128) === memberId;
}

export function buildCommunityMembershipReviewNotificationId(
  communityId: string,
  memberId: string,
  requestCycleStartedAtMs: number,
  outcome: CommunityMembershipReviewOutcome
): string {
  return stableId('community_membership_review', [
    communityId,
    memberId,
    String(Math.max(0, Math.trunc(requestCycleStartedAtMs))),
    outcome,
  ]);
}

export function buildCommunityInviteResponseNotificationId(
  inviteId: string,
  senderId: string,
  outcome: CommunityInviteNotificationOutcome
): string {
  return stableId('community_invite_response', [
    inviteId,
    senderId,
    outcome,
  ]);
}

export function buildCommunityInviteResponseNotificationCopy(input: {
  outcome: CommunityInviteNotificationOutcome;
  communityName: unknown;
}): { title: string; body: string } {
  const communityName = normalizeText(input.communityName, 60) || 'a Comunidade';

  return input.outcome === 'accepted'
    ? {
      title: 'Convite aceito',
      body: `Seu convite para ${communityName} foi aceito.`,
    }
    : {
      title: 'Convite recusado',
      body: `Seu convite para ${communityName} foi recusado.`,
    };
}

export function buildCommunityMemberLifecycleNotificationId(
  communityId: string,
  memberId: string,
  cycleStartedAtMs: number,
  action: CommunityMemberLifecycleNotificationAction
): string {
  return stableId('community_member_lifecycle', [
    communityId,
    memberId,
    String(Math.max(0, Math.trunc(cycleStartedAtMs))),
    action,
  ]);
}

export function buildCommunityMemberLifecycleNotificationCopy(input: {
  action: CommunityMemberLifecycleNotificationAction;
  communityName: unknown;
}): { title: string; body: string } {
  const communityName = normalizeText(input.communityName, 60) || 'a Comunidade';

  if (input.action === 'block') {
    return {
      title: 'Acesso à Comunidade bloqueado',
      body: `Seu acesso a ${communityName} foi bloqueado pela gestão.`,
    };
  }

  if (input.action === 'unblock') {
    return {
      title: 'Bloqueio removido',
      body: `O bloqueio de acesso a ${communityName} foi removido.`,
    };
  }

  return {
    title: 'Participação encerrada',
    body: `Sua participação em ${communityName} foi encerrada pela gestão.`,
  };
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

export function buildCommunityPostReplyNotificationCopy(input: {
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
      title: 'Nova resposta à sua publicação',
      body: `${actorLabel} respondeu à sua publicação em ${communityName}.`,
      activityCount,
    };
  }

  return {
    title: `${activityCount} novas respostas à sua publicação`,
    body: `Sua publicação em ${communityName} recebeu ${activityCount} novas respostas.`,
    activityCount,
  };
}

export function buildCommunityMembershipReviewNotificationCopy(input: {
  outcome: CommunityMembershipReviewOutcome;
  communityName: unknown;
}): { title: string; body: string } {
  const communityName = normalizeText(input.communityName, 60) || 'a Comunidade';

  return input.outcome === 'approved'
    ? {
      title: 'Entrada aprovada',
      body: `Seu pedido para entrar em ${communityName} foi aprovado.`,
    }
    : {
      title: 'Pedido de entrada não aprovado',
      body: `Seu pedido para entrar em ${communityName} não foi aprovado.`,
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

export function buildCommunityNotificationRoute(
  communityId: string,
  postId?: string | null,
  commentId?: string | null
): string {
  const base = `/dashboard/comunidades/${encodeURIComponent(communityId)}`;
  const normalizedPostId = String(postId ?? '').trim();

  if (!normalizedPostId) return base;

  const query = [
    `post=${encodeURIComponent(normalizedPostId)}`,
  ];
  const normalizedCommentId = String(commentId ?? '').trim();

  if (normalizedCommentId) {
    query.push(`comentario=${encodeURIComponent(normalizedCommentId)}`);
  }

  return `${base}?${query.join('&')}`;
}

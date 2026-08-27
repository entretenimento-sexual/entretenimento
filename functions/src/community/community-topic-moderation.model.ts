// functions/src/community/community-topic-moderation.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPIC MODERATION CONTRACTS
// -----------------------------------------------------------------------------
// Normaliza comandos de moderação antes da autorização/transação.
// Remoção é lógica: o conteúdo operacional permanece preservado para auditoria.
// -----------------------------------------------------------------------------

import type { CommunityTopicStatus } from './community-topic.model';

export type CommunityTopicModerationAction = 'lock' | 'unlock' | 'remove';
export type CommunityTopicModerationState = 'active' | 'removed';

export interface CommunityTopicModerationRequest {
  requestId?: unknown;
  communityId?: unknown;
  topicId?: unknown;
  action?: unknown;
  reason?: unknown;
}

export interface NormalizedCommunityTopicModerationRequest {
  requestId: string | null;
  communityId: string | null;
  topicId: string | null;
  action: CommunityTopicModerationAction | null;
  reason: string | null;
  reasonTooLong: boolean;
}

export interface CommunityTopicModerationResponse {
  communityId: string;
  topicId: string;
  action: CommunityTopicModerationAction;
  status: CommunityTopicStatus;
  moderationState: CommunityTopicModerationState;
  deduplicated: boolean;
  generatedAt: number;
}

export type CommunityTopicModerationDenialReason =
  | 'invalid_state'
  | 'removed_topic'
  | 'removal_reason_required';

export interface CommunityTopicModerationTransition {
  allowed: boolean;
  idempotent: boolean;
  nextStatus: CommunityTopicStatus | null;
  nextModerationState: CommunityTopicModerationState | null;
  deleteProjection: boolean;
  denialReason: CommunityTopicModerationDenialReason | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_REASON_LENGTH = 240;

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value: unknown, maxLength: number): string {
  return cleanText(value).slice(0, maxLength);
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = normalizeText(value, 128);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeAction(value: unknown): CommunityTopicModerationAction | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'lock' || normalized === 'unlock' || normalized === 'remove'
    ? normalized
    : null;
}

export function normalizeCommunityTopicModerationRequest(
  raw: CommunityTopicModerationRequest | null | undefined
): NormalizedCommunityTopicModerationRequest {
  const fullReason = cleanText(raw?.reason);

  return {
    requestId: normalizeSafeId(raw?.requestId),
    communityId: normalizeSafeId(raw?.communityId),
    topicId: normalizeSafeId(raw?.topicId),
    action: normalizeAction(raw?.action),
    reason: fullReason ? fullReason.slice(0, MAX_REASON_LENGTH) : null,
    reasonTooLong: fullReason.length > MAX_REASON_LENGTH,
  };
}

export function evaluateCommunityTopicModerationTransition(input: {
  action: CommunityTopicModerationAction;
  currentStatus: CommunityTopicStatus | null;
  currentModerationState: CommunityTopicModerationState | null;
  reason: string | null;
}): CommunityTopicModerationTransition {
  const {
    action,
    currentStatus,
    currentModerationState,
    reason,
  } = input;

  if (
    currentStatus === 'archived'
    || currentModerationState === 'removed'
  ) {
    if (action === 'remove') {
      return {
        allowed: true,
        idempotent: true,
        nextStatus: 'archived',
        nextModerationState: 'removed',
        deleteProjection: true,
        denialReason: null,
      };
    }

    return {
      allowed: false,
      idempotent: false,
      nextStatus: null,
      nextModerationState: null,
      deleteProjection: false,
      denialReason: 'removed_topic',
    };
  }

  if (
    currentModerationState !== 'active'
    || (currentStatus !== 'active' && currentStatus !== 'locked')
  ) {
    return {
      allowed: false,
      idempotent: false,
      nextStatus: null,
      nextModerationState: null,
      deleteProjection: false,
      denialReason: 'invalid_state',
    };
  }

  if (action === 'remove') {
    if (!reason || reason.length < 3) {
      return {
        allowed: false,
        idempotent: false,
        nextStatus: null,
        nextModerationState: null,
        deleteProjection: false,
        denialReason: 'removal_reason_required',
      };
    }

    return {
      allowed: true,
      idempotent: false,
      nextStatus: 'archived',
      nextModerationState: 'removed',
      deleteProjection: true,
      denialReason: null,
    };
  }

  const desiredStatus: CommunityTopicStatus = action === 'lock' ? 'locked' : 'active';

  return {
    allowed: true,
    idempotent: currentStatus === desiredStatus,
    nextStatus: desiredStatus,
    nextModerationState: 'active',
    deleteProjection: false,
    denialReason: null,
  };
}

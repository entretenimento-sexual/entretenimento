// functions/src/community/community-topic-detail.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPIC DETAIL CONTRACTS
// -----------------------------------------------------------------------------
// Contratos sanitizados para leitura de um Tópico e de suas respostas.
// O documento operacional permanece backend-only; somente estes campos podem
// atravessar a fronteira da callable.
// -----------------------------------------------------------------------------

import type {
  CommunityTopicAudience,
  CommunityTopicAuthor,
  CommunityTopicMetrics,
  CommunityTopicStatus,
} from './community-topic.model';

export interface CommunityTopicDetailRequest {
  communityId?: unknown;
  topicId?: unknown;
}

export interface NormalizedCommunityTopicDetailRequest {
  communityId: string | null;
  topicId: string | null;
}

export interface CommunityTopicRepliesPageRequest
  extends CommunityTopicDetailRequest {
  limit?: unknown;
  cursor?: unknown;
}

export interface NormalizedCommunityTopicRepliesPageRequest
  extends NormalizedCommunityTopicDetailRequest {
  limit: number;
  cursor: string | null;
}

export interface CommunityTopicDetail {
  topicId: string;
  title: string;
  body: string;
  author: CommunityTopicAuthor;
  status: Exclude<CommunityTopicStatus, 'archived'>;
  metrics: CommunityTopicMetrics;
  createdAt: number;
  lastActivityAt: number;
}

export interface SanitizedCommunityTopicDetail {
  audience: CommunityTopicAudience;
  item: CommunityTopicDetail;
}

export interface CommunityTopicDetailResponse {
  topic: CommunityTopicDetail;
  canReply: boolean;
  generatedAt: number;
}

export interface CommunityTopicReplyItem {
  replyId: string;
  body: string;
  author: CommunityTopicAuthor;
  createdAt: number;
}

export interface CommunityTopicRepliesPageResponse {
  items: CommunityTopicReplyItem[];
  nextCursor: string | null;
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const DEFAULT_REPLY_PAGE_LIMIT = 20;
const MAX_REPLY_PAGE_LIMIT = 40;
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 5_000;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeRequiredText(
  value: unknown,
  maxLength: number,
  minimumLength: number
): string | null {
  const normalized = normalizeText(value, maxLength);
  return normalized.length >= minimumLength ? normalized : null;
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = normalizeText(value, 128);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.trunc(parsed), 0), 1_000_000_000)
    : 0;
}

function normalizeTimestamp(value: unknown): number | null {
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

function sanitizeAuthor(raw: unknown): CommunityTopicAuthor | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const label = normalizeRequiredText(source['label'], 60, 2);
  if (!label) return null;

  return {
    label,
    avatarUrl: normalizeHttpsUrl(source['avatarUrl']),
  };
}

export function normalizeCommunityTopicDetailRequest(
  raw: CommunityTopicDetailRequest | null | undefined
): NormalizedCommunityTopicDetailRequest {
  return {
    communityId: normalizeSafeId(raw?.communityId),
    topicId: normalizeSafeId(raw?.topicId),
  };
}

export function normalizeCommunityTopicRepliesPageRequest(
  raw: CommunityTopicRepliesPageRequest | null | undefined
): NormalizedCommunityTopicRepliesPageRequest {
  const base = normalizeCommunityTopicDetailRequest(raw);
  const parsedLimit = Math.trunc(Number(raw?.limit));

  return {
    ...base,
    limit: Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_REPLY_PAGE_LIMIT)
      : DEFAULT_REPLY_PAGE_LIMIT,
    cursor: normalizeSafeId(raw?.cursor),
  };
}

export function sanitizeCommunityTopicDetail(
  documentId: string,
  raw: unknown,
  now = Date.now()
): SanitizedCommunityTopicDetail | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const metrics = (source['metrics'] ?? {}) as Record<string, unknown>;
  const topicId = normalizeSafeId(documentId);
  const title = normalizeRequiredText(source['title'], MAX_TITLE_LENGTH, 3);
  const body = normalizeRequiredText(source['body'], MAX_BODY_LENGTH, 1);
  const author = sanitizeAuthor(source['author']);
  const createdAt = normalizeTimestamp(source['createdAt']);
  const lastActivityAt = normalizeTimestamp(source['lastActivityAt']);
  const audience = source['audience'];
  const status = source['status'];

  if (
    !topicId
    || !title
    || !body
    || !author
    || (audience !== 'public_preview' && audience !== 'members_only')
    || (status !== 'active' && status !== 'locked')
    || source['moderationState'] !== 'active'
    || createdAt === null
    || lastActivityAt === null
    || createdAt > now + 5 * 60_000
    || lastActivityAt > now + 5 * 60_000
    || lastActivityAt < createdAt
  ) {
    return null;
  }

  return {
    audience,
    item: {
      topicId,
      title,
      body,
      author,
      status,
      metrics: {
        replyCount: normalizeCount(metrics['replyCount']),
        reactionCount: normalizeCount(metrics['reactionCount']),
      },
      createdAt,
      lastActivityAt,
    },
  };
}

export function sanitizeCommunityTopicReplyProjection(
  documentId: string,
  raw: unknown,
  now = Date.now()
): CommunityTopicReplyItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const replyId = normalizeSafeId(documentId);
  const body = normalizeRequiredText(source['body'], MAX_BODY_LENGTH, 1);
  const author = sanitizeAuthor(source['author']);
  const createdAt = normalizeTimestamp(source['createdAt']);

  if (
    !replyId
    || !body
    || !author
    || source['moderationState'] !== 'active'
    || createdAt === null
    || createdAt > now + 5 * 60_000
  ) {
    return null;
  }

  return {
    replyId,
    body,
    author,
    createdAt,
  };
}

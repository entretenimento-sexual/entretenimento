// src/app/community/data-access/community-topic.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPIC CLIENT CONTRACT
// -----------------------------------------------------------------------------
// Toda resposta das callables de Tópicos é normalizada novamente no navegador.
// O cliente nunca confia diretamente na forma retornada pela Function.
// -----------------------------------------------------------------------------

export type CommunityTopicStatus = 'active' | 'locked';
export type CommunityTopicModerationAction = 'lock' | 'unlock' | 'remove';
export type CommunityTopicModerationState = 'active' | 'removed';
export type CommunityTopicModerationResultStatus =
  | CommunityTopicStatus
  | 'archived';

export interface CommunityTopicAuthor {
  readonly label: string;
  readonly avatarUrl: string | null;
}

export interface CommunityTopicMetrics {
  readonly replyCount: number;
  readonly reactionCount: number;
}

export interface CommunityTopicListItem {
  readonly topicId: string;
  readonly title: string;
  readonly excerpt: string;
  readonly author: CommunityTopicAuthor;
  readonly status: CommunityTopicStatus;
  readonly metrics: CommunityTopicMetrics;
  readonly createdAt: number;
  readonly lastActivityAt: number;
}

export interface CommunityTopicPage {
  readonly items: readonly CommunityTopicListItem[];
  readonly nextCursor: string | null;
  readonly generatedAt: number;
}

export interface CommunityTopicPageRequest {
  readonly communityId: string;
  readonly limit?: number;
  readonly cursor?: string | null;
}

export interface CommunityTopicDetail extends CommunityTopicListItem {
  readonly body: string;
}

export interface CommunityTopicDetailResponse {
  readonly topic: CommunityTopicDetail;
  readonly canReply: boolean;
  readonly generatedAt: number;
}

export interface CommunityTopicDetailRequest {
  readonly communityId: string;
  readonly topicId: string;
}

export interface CommunityTopicReplyItem {
  readonly replyId: string;
  readonly body: string;
  readonly author: CommunityTopicAuthor;
  readonly createdAt: number;
}

export interface CommunityTopicRepliesPage {
  readonly items: readonly CommunityTopicReplyItem[];
  readonly nextCursor: string | null;
  readonly generatedAt: number;
}

export interface CommunityTopicRepliesPageRequest
  extends CommunityTopicDetailRequest {
  readonly limit?: number;
  readonly cursor?: string | null;
}

export interface CommunityTopicCreateRequest {
  readonly requestId: string;
  readonly communityId: string;
  readonly title: string;
  readonly body: string;
  readonly audience?: 'public_preview' | 'members_only';
}

export interface CommunityTopicCreateResponse {
  readonly communityId: string;
  readonly topicId: string;
  readonly created: boolean;
  readonly deduplicated: boolean;
}

export interface CommunityTopicReplyCreateRequest
  extends CommunityTopicDetailRequest {
  readonly requestId: string;
  readonly body: string;
}

export interface CommunityTopicReplyCreateResponse {
  readonly communityId: string;
  readonly topicId: string;
  readonly replyId: string;
  readonly replyCount: number;
  readonly created: boolean;
  readonly deduplicated: boolean;
}

export interface CommunityTopicModerationRequest
  extends CommunityTopicDetailRequest {
  readonly requestId: string;
  readonly action: CommunityTopicModerationAction;
  readonly reason?: string | null;
}

export interface CommunityTopicModerationResponse {
  readonly communityId: string;
  readonly topicId: string;
  readonly action: CommunityTopicModerationAction;
  readonly status: CommunityTopicModerationResultStatus;
  readonly moderationState: CommunityTopicModerationState;
  readonly deduplicated: boolean;
  readonly generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MIN_TIMESTAMP = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\p{Cc}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = normalizeText(value, 128);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
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
  const parsed = Number(value);
  return Number.isFinite(parsed)
    && parsed >= MIN_TIMESTAMP
    && parsed <= Date.now() + MAX_FUTURE_SKEW_MS
    ? Math.trunc(parsed)
    : null;
}

function normalizeAuthor(raw: unknown): CommunityTopicAuthor | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const label = normalizeText(source['label'], 60);
  if (label.length < 2) return null;

  return {
    label,
    avatarUrl: normalizeHttpsUrl(source['avatarUrl']),
  };
}

function normalizeMetrics(raw: unknown): CommunityTopicMetrics {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    replyCount: normalizeCount(source['replyCount']),
    reactionCount: normalizeCount(source['reactionCount']),
  };
}

function normalizeListItem(raw: unknown): CommunityTopicListItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const topicId = normalizeSafeId(source['topicId']);
  const title = normalizeText(source['title'], 120);
  const excerpt = normalizeText(source['excerpt'], 320);
  const author = normalizeAuthor(source['author']);
  const status = source['status'];
  const createdAt = normalizeTimestamp(source['createdAt']);
  const lastActivityAt = normalizeTimestamp(source['lastActivityAt']);

  if (
    !topicId
    || title.length < 3
    || !excerpt
    || !author
    || (status !== 'active' && status !== 'locked')
    || createdAt === null
    || lastActivityAt === null
    || lastActivityAt < createdAt
  ) {
    return null;
  }

  return {
    topicId,
    title,
    excerpt,
    author,
    status,
    metrics: normalizeMetrics(source['metrics']),
    createdAt,
    lastActivityAt,
  };
}

function normalizeReplyItem(raw: unknown): CommunityTopicReplyItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const replyId = normalizeSafeId(source['replyId']);
  const body = normalizeText(source['body'], 5_000);
  const author = normalizeAuthor(source['author']);
  const createdAt = normalizeTimestamp(source['createdAt']);

  if (!replyId || !body || !author || createdAt === null) return null;

  return { replyId, body, author, createdAt };
}

export function normalizeCommunityTopicPageResponse(raw: unknown): CommunityTopicPage {
  const source = (raw ?? {}) as Record<string, unknown>;
  const generatedAt = normalizeTimestamp(source['generatedAt']) ?? Date.now();

  return {
    items: Array.isArray(source['items'])
      ? source['items']
          .map(normalizeListItem)
          .filter((item): item is CommunityTopicListItem => item !== null)
      : [],
    nextCursor: normalizeSafeId(source['nextCursor']),
    generatedAt,
  };
}

export function normalizeCommunityTopicDetailResponse(
  raw: unknown
): CommunityTopicDetailResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const topicSource = (source['topic'] ?? {}) as Record<string, unknown>;
  const listItem = normalizeListItem({
    ...topicSource,
    excerpt: topicSource['body'],
  });
  const body = normalizeText(topicSource['body'], 5_000);

  if (!listItem || !body) {
    throw new Error('Resposta de detalhe de Tópico inválida.');
  }

  return {
    topic: {
      ...listItem,
      excerpt: normalizeText(topicSource['excerpt'] ?? body, 320) || body.slice(0, 320),
      body,
    },
    canReply: source['canReply'] === true && listItem.status === 'active',
    generatedAt: normalizeTimestamp(source['generatedAt']) ?? Date.now(),
  };
}

export function normalizeCommunityTopicRepliesPageResponse(
  raw: unknown
): CommunityTopicRepliesPage {
  const source = (raw ?? {}) as Record<string, unknown>;

  return {
    items: Array.isArray(source['items'])
      ? source['items']
          .map(normalizeReplyItem)
          .filter((item): item is CommunityTopicReplyItem => item !== null)
      : [],
    nextCursor: normalizeSafeId(source['nextCursor']),
    generatedAt: normalizeTimestamp(source['generatedAt']) ?? Date.now(),
  };
}

export function normalizeCommunityTopicCreateResponse(
  raw: unknown
): CommunityTopicCreateResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const topicId = normalizeSafeId(source['topicId']);

  if (!communityId || !topicId) {
    throw new Error('Resposta de criação de Tópico inválida.');
  }

  return {
    communityId,
    topicId,
    created: source['created'] === true,
    deduplicated: source['deduplicated'] === true,
  };
}

export function normalizeCommunityTopicReplyCreateResponse(
  raw: unknown
): CommunityTopicReplyCreateResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const topicId = normalizeSafeId(source['topicId']);
  const replyId = normalizeSafeId(source['replyId']);

  if (!communityId || !topicId || !replyId) {
    throw new Error('Resposta de criação de resposta inválida.');
  }

  return {
    communityId,
    topicId,
    replyId,
    replyCount: normalizeCount(source['replyCount']),
    created: source['created'] === true,
    deduplicated: source['deduplicated'] === true,
  };
}

export function normalizeCommunityTopicModerationResponse(
  raw: unknown
): CommunityTopicModerationResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const topicId = normalizeSafeId(source['topicId']);
  const action = source['action'];
  const status = source['status'];
  const moderationState = source['moderationState'];
  const generatedAt = normalizeTimestamp(source['generatedAt']);

  if (
    !communityId
    || !topicId
    || (action !== 'lock' && action !== 'unlock' && action !== 'remove')
    || (status !== 'active' && status !== 'locked' && status !== 'archived')
    || (moderationState !== 'active' && moderationState !== 'removed')
    || generatedAt === null
  ) {
    throw new Error('Resposta de moderação de Tópico inválida.');
  }

  return {
    communityId,
    topicId,
    action,
    status,
    moderationState,
    deduplicated: source['deduplicated'] === true,
    generatedAt,
  };
}

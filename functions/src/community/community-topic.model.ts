// functions/src/community/community-topic.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY TOPIC CONTRACTS
// -----------------------------------------------------------------------------
// Contratos sanitizados para discussões persistentes de Comunidades e Locais.
// Tópico não é Sala: respostas permanecem organizadas em uma discussão durável,
// enquanto conversa em tempo real continua pertencendo ao domínio de chat.
//
// Segurança:
// - nenhuma projeção expõe UID, localização precisa ou metadados de moderação;
// - leitura pública significa somente `public_preview` para viewer autenticado que
//   já passou pelo contexto de acesso comunitário;
// - comandos são normalizados aqui, mas autorização continua backend-only.
// -----------------------------------------------------------------------------

export type CommunityTopicAudience = 'public_preview' | 'members_only';
export type CommunityTopicStatus = 'active' | 'locked' | 'archived';

export interface CommunityTopicPageRequest {
  communityId?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface NormalizedCommunityTopicPageRequest {
  communityId: string | null;
  limit: number;
  cursor: string | null;
}

export interface CommunityTopicCreateRequest {
  requestId?: unknown;
  communityId?: unknown;
  title?: unknown;
  body?: unknown;
  audience?: unknown;
}

export interface NormalizedCommunityTopicCreateRequest {
  requestId: string | null;
  communityId: string | null;
  title: string | null;
  body: string | null;
  audience: CommunityTopicAudience;
}

export interface CommunityTopicReplyCreateRequest {
  requestId?: unknown;
  communityId?: unknown;
  topicId?: unknown;
  body?: unknown;
}

export interface NormalizedCommunityTopicReplyCreateRequest {
  requestId: string | null;
  communityId: string | null;
  topicId: string | null;
  body: string | null;
}

export interface CommunityTopicWriteResponse {
  communityId: string;
  topicId: string;
  created: boolean;
  deduplicated: boolean;
}

export interface CommunityTopicReplyWriteResponse {
  communityId: string;
  topicId: string;
  replyId: string;
  replyCount: number;
  created: boolean;
  deduplicated: boolean;
}

export interface CommunityTopicAuthor {
  label: string;
  avatarUrl: string | null;
}

export interface CommunityTopicMetrics {
  replyCount: number;
  reactionCount: number;
}

export interface CommunityTopicListItem {
  topicId: string;
  title: string;
  excerpt: string;
  author: CommunityTopicAuthor;
  status: Exclude<CommunityTopicStatus, 'archived'>;
  metrics: CommunityTopicMetrics;
  createdAt: number;
  lastActivityAt: number;
}

export interface SanitizedCommunityTopicProjection {
  audience: CommunityTopicAudience;
  item: CommunityTopicListItem;
}

export interface CommunityTopicPageResponse {
  items: CommunityTopicListItem[];
  nextCursor: string | null;
  generatedAt: number;
}

const DEFAULT_PAGE_LIMIT = 12;
const MAX_PAGE_LIMIT = 24;
const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 5_000;
const MAX_EXCERPT_LENGTH = 320;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = normalizeText(value, 128);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeRequiredText(
  value: unknown,
  maxLength: number,
  minimumLength: number
): string | null {
  const normalized = normalizeText(value, maxLength);
  return normalized.length >= minimumLength ? normalized : null;
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

function normalizeAudience(value: unknown): CommunityTopicAudience {
  return value === 'members_only' ? 'members_only' : 'public_preview';
}

export function normalizeCommunityTopicPageRequest(
  raw: CommunityTopicPageRequest | null | undefined
): NormalizedCommunityTopicPageRequest {
  const parsedLimit = Math.trunc(Number(raw?.limit));

  return {
    communityId: normalizeSafeId(raw?.communityId),
    limit: Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT,
    cursor: normalizeSafeId(raw?.cursor),
  };
}

export function normalizeCommunityTopicCreateRequest(
  raw: CommunityTopicCreateRequest | null | undefined
): NormalizedCommunityTopicCreateRequest {
  return {
    requestId: normalizeSafeId(raw?.requestId),
    communityId: normalizeSafeId(raw?.communityId),
    title: normalizeRequiredText(raw?.title, MAX_TITLE_LENGTH, 3),
    body: normalizeRequiredText(raw?.body, MAX_BODY_LENGTH, 1),
    audience: normalizeAudience(raw?.audience),
  };
}

export function normalizeCommunityTopicReplyCreateRequest(
  raw: CommunityTopicReplyCreateRequest | null | undefined
): NormalizedCommunityTopicReplyCreateRequest {
  return {
    requestId: normalizeSafeId(raw?.requestId),
    communityId: normalizeSafeId(raw?.communityId),
    topicId: normalizeSafeId(raw?.topicId),
    body: normalizeRequiredText(raw?.body, MAX_BODY_LENGTH, 1),
  };
}

export function sanitizeCommunityTopicProjection(
  documentId: string,
  raw: unknown,
  now = Date.now()
): SanitizedCommunityTopicProjection | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const author = (source['author'] ?? {}) as Record<string, unknown>;
  const metrics = (source['metrics'] ?? {}) as Record<string, unknown>;
  const topicId = normalizeSafeId(documentId);
  const title = normalizeRequiredText(source['title'], MAX_TITLE_LENGTH, 3);
  const excerpt = normalizeRequiredText(source['excerpt'], MAX_EXCERPT_LENGTH, 1);
  const authorLabel = normalizeRequiredText(author['label'], 60, 2);
  const createdAt = normalizeTimestamp(source['createdAt']);
  const lastActivityAt = normalizeTimestamp(source['lastActivityAt']);
  const audience = source['audience'];
  const status = source['status'];

  if (
    !topicId
    || !title
    || !excerpt
    || !authorLabel
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
      excerpt,
      author: {
        label: authorLabel,
        avatarUrl: normalizeHttpsUrl(author['avatarUrl']),
      },
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

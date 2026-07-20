// functions/src/community/community-feed.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED CONTRACTS
// -----------------------------------------------------------------------------
// Contrato sanitizado do mural comunitário somente leitura.
// A projeção é backend-only e nunca expõe UID, localização precisa ou metadados
// internos de moderação.
// -----------------------------------------------------------------------------

export type CommunityFeedView = 'feed' | 'photos';
export type CommunityFeedKind = 'text' | 'photo';
export type CommunityFeedAudience = 'public_preview' | 'members_only';

export interface CommunityFeedPageRequest {
  communityId?: unknown;
  view?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface NormalizedCommunityFeedPageRequest {
  communityId: string | null;
  view: CommunityFeedView;
  limit: number;
  cursor: string | null;
}

export interface CommunityFeedItem {
  postId: string;
  kind: CommunityFeedKind;
  author: {
    label: string;
    avatarUrl: string | null;
  };
  text: string | null;
  image: {
    url: string;
    alt: string;
  } | null;
  metrics: {
    commentCount: number;
    reactionCount: number;
  };
  publishedAt: number;
}

export interface SanitizedCommunityFeedProjection {
  audience: CommunityFeedAudience;
  item: CommunityFeedItem;
}

export interface CommunityFeedPageResponse {
  items: CommunityFeedItem[];
  nextCursor: string | null;
  generatedAt: number;
}

const DEFAULT_PAGE_LIMIT = 10;
const MAX_PAGE_LIMIT = 20;
const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

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
    return Number.isFinite(time) ? time : null;
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

export function normalizeCommunityFeedPageRequest(
  raw: CommunityFeedPageRequest | null | undefined
): NormalizedCommunityFeedPageRequest {
  const parsedLimit = Math.trunc(Number(raw?.limit));
  const view = raw?.view === 'photos' ? 'photos' : 'feed';

  return {
    communityId: normalizeSafeId(raw?.communityId),
    view,
    limit: Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT,
    cursor: normalizeSafeId(raw?.cursor),
  };
}

export function sanitizeCommunityFeedProjection(
  documentId: string,
  raw: unknown,
  now = Date.now()
): SanitizedCommunityFeedProjection | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const author = (source['author'] ?? {}) as Record<string, unknown>;
  const image = (source['image'] ?? {}) as Record<string, unknown>;
  const metrics = (source['metrics'] ?? {}) as Record<string, unknown>;
  const postId = normalizeSafeId(documentId);
  const kind = source['kind'];
  const audience = source['audience'];
  const authorLabel = normalizeText(author['label'], 60);
  const text = normalizeText(source['text'], 1_000);
  const publishedAt = normalizeTimestamp(source['publishedAt']);
  const expiresAt = source['expiresAt'] == null
    ? null
    : normalizeTimestamp(source['expiresAt']);

  if (
    !postId
    || (kind !== 'text' && kind !== 'photo')
    || (audience !== 'public_preview' && audience !== 'members_only')
    || source['status'] !== 'active'
    || source['moderationState'] !== 'active'
    || authorLabel.length < 2
    || publishedAt === null
    || publishedAt > now + 5 * 60_000
    || (source['expiresAt'] != null && expiresAt === null)
    || (expiresAt !== null && expiresAt <= now)
  ) {
    return null;
  }

  const imageUrl = normalizeHttpsUrl(image['url']);
  const imageAlt = normalizeText(image['alt'], 140);

  if (kind === 'text' && text.length < 1) return null;
  if (kind === 'photo' && !imageUrl) return null;

  return {
    audience,
    item: {
      postId,
      kind,
      author: {
        label: authorLabel,
        avatarUrl: normalizeHttpsUrl(author['avatarUrl']),
      },
      text: text || null,
      image: imageUrl
        ? {
          url: imageUrl,
          alt: imageAlt || 'Foto publicada na comunidade',
        }
        : null,
      metrics: {
        commentCount: normalizeCount(metrics['commentCount']),
        reactionCount: normalizeCount(metrics['reactionCount']),
      },
      publishedAt,
    },
  };
}

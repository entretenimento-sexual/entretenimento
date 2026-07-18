// src/app/community/data-access/community-feed.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED CLIENT CONTRACT
// -----------------------------------------------------------------------------
// Toda resposta da callable é normalizada novamente no navegador.
// -----------------------------------------------------------------------------

export type CommunityFeedView = 'feed' | 'photos';
export type CommunityFeedKind = 'text' | 'photo';

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

export interface CommunityFeedPage {
  items: readonly CommunityFeedItem[];
  nextCursor: string | null;
  generatedAt: number;
}

export interface CommunityFeedPageRequest {
  communityId: string;
  view: CommunityFeedView;
  limit?: number;
  cursor?: string | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MIN_PUBLISHED_AT = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

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

function normalizeItem(raw: unknown): CommunityFeedItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const author = (source['author'] ?? {}) as Record<string, unknown>;
  const image = (source['image'] ?? {}) as Record<string, unknown>;
  const metrics = (source['metrics'] ?? {}) as Record<string, unknown>;
  const postId = normalizeSafeId(source['postId']);
  const kind = source['kind'];
  const authorLabel = normalizeText(author['label'], 60);
  const text = normalizeText(source['text'], 1_000);
  const publishedAt = Number(source['publishedAt']);

  if (
    !postId
    || (kind !== 'text' && kind !== 'photo')
    || authorLabel.length < 2
    || !Number.isFinite(publishedAt)
    || publishedAt < MIN_PUBLISHED_AT
    || publishedAt > Date.now() + MAX_FUTURE_SKEW_MS
  ) {
    return null;
  }

  const imageUrl = normalizeHttpsUrl(image['url']);
  const imageAlt = normalizeText(image['alt'], 140);

  if (kind === 'text' && !text) return null;
  if (kind === 'photo' && !imageUrl) return null;

  return {
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
    publishedAt: Math.trunc(publishedAt),
  };
}

export function normalizeCommunityFeedPageResponse(
  raw: unknown
): CommunityFeedPage {
  const source = (raw ?? {}) as Record<string, unknown>;
  const generatedAt = Number(source['generatedAt']);

  return {
    items: Array.isArray(source['items'])
      ? source['items']
          .map(normalizeItem)
          .filter((item): item is CommunityFeedItem => item !== null)
      : [],
    nextCursor: normalizeSafeId(source['nextCursor']),
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
  };
}

// src/app/community/data-access/community-feed.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED CLIENT CONTRACT
// -----------------------------------------------------------------------------
// Toda resposta da callable é normalizada novamente no navegador.
// -----------------------------------------------------------------------------

import {
  CommunityPublicAuthor,
  normalizeCommunityPublicAuthor,
} from './community-public-author.model';

export type CommunityFeedView = 'feed' | 'photos';
export type CommunityFeedKind = 'text' | 'photo' | 'location';
export type CommunityFeedAudience = 'public_preview' | 'members_only';

export interface CommunityFeedReplyReference {
  readonly postId: string;
  readonly authorLabel: string;
  readonly textPreview: string;
  readonly available: boolean;
}

export interface CommunityFeedLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly precision: 'approximate';
}

export interface CommunityFeedItem {
  postId: string;
  kind: CommunityFeedKind;
  author: CommunityPublicAuthor;
  text: string | null;
  image: {
    url: string;
    alt: string;
  } | null;
  location?: CommunityFeedLocation | null;
  replyTo: CommunityFeedReplyReference | null;
  metrics: {
    commentCount: number;
    reactionCount: number;
  };
  capabilities: {
    canDeleteOwn: boolean;
    canModerate: boolean;
    canReport: boolean;
    canReact: boolean;
    viewerReacted: boolean;
    canViewComments: boolean;
    canComment: boolean;
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

export interface CommunityFeedPostCreateRequest {
  readonly requestId: string;
  readonly communityId: string;
  readonly text: string;
  readonly audience: CommunityFeedAudience;
  readonly imageUploadPath?: string | null;
  readonly location?: {
    readonly latitude: number;
    readonly longitude: number;
  } | null;
  readonly replyToPostId?: string | null;
}

export interface CommunityFeedPostCreateResponse {
  readonly communityId: string;
  readonly postId: string;
  readonly created: boolean;
  readonly deduplicated: boolean;
}

export type CommunityFeedPostAction = 'delete_own' | 'remove';

export interface CommunityFeedPostActionRequest {
  readonly requestId: string;
  readonly communityId: string;
  readonly postId: string;
  readonly action: CommunityFeedPostAction;
  readonly reason?: string | null;
}

export interface CommunityFeedPostActionResponse {
  readonly communityId: string;
  readonly postId: string;
  readonly action: CommunityFeedPostAction;
  readonly status: 'deleted' | 'removed';
  readonly deduplicated: boolean;
  readonly generatedAt: number;
}

export interface CommunityFeedReactionRequest {
  readonly communityId: string;
  readonly postId: string;
}

export interface CommunityFeedReactionResponse {
  readonly communityId: string;
  readonly postId: string;
  readonly reacted: boolean;
  readonly reactionCount: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MIN_PUBLISHED_AT = Date.UTC(2000, 0, 1);
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

function normalizeText(value: unknown, maxLength: number): string {
  return Array.from(String(value ?? ''))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint === 9 || codePoint === 10 || codePoint === 13) return ' ';
      return codePoint >= 32 && codePoint !== 127 ? character : '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = normalizeText(value, 128);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

function normalizeMediaUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'https:') return parsed.toString();
    if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
      return parsed.toString();
    }
    return null;
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

function normalizeCommunityFeedLocation(value: unknown): CommunityFeedLocation | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const latitude = Number(source['latitude']);
  const longitude = Number(source['longitude']);

  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }

  return {
    latitude: Number(latitude.toFixed(2)),
    longitude: Number(longitude.toFixed(2)),
    precision: 'approximate',
  };
}

function normalizeReplyReference(value: unknown): CommunityFeedReplyReference | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const postId = normalizeSafeId(source['postId']);
  if (!postId) return null;

  const available = source['available'] === true;
  const authorLabel = normalizeText(source['authorLabel'], 60)
    || (available ? 'Participante' : 'Publicação');
  const textPreview = normalizeText(source['textPreview'], 180)
    || (available ? 'Publicação no Mural' : 'Conteúdo original indisponível');

  return {
    postId,
    authorLabel,
    textPreview,
    available,
  };
}

function normalizeItem(raw: unknown): CommunityFeedItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const image = (source['image'] ?? {}) as Record<string, unknown>;
  const metrics = (source['metrics'] ?? {}) as Record<string, unknown>;
  const capabilities = (source['capabilities'] ?? {}) as Record<string, unknown>;
  const postId = normalizeSafeId(source['postId']);
  const kind = source['kind'];
  const author = normalizeCommunityPublicAuthor(source['author']);
  const text = normalizeText(source['text'], 1_000);
  const location = normalizeCommunityFeedLocation(source['location']);
  const publishedAt = Number(source['publishedAt']);

  if (
    !postId
    || (kind !== 'text' && kind !== 'photo' && kind !== 'location')
    || !author
    || !Number.isFinite(publishedAt)
    || publishedAt < MIN_PUBLISHED_AT
    || publishedAt > Date.now() + MAX_FUTURE_SKEW_MS
  ) {
    return null;
  }

  const imageUrl = normalizeMediaUrl(image['url']);
  const imageAlt = normalizeText(image['alt'], 140);

  if (kind === 'text' && !text) return null;
  if (kind === 'photo' && !imageUrl) return null;
  if (kind === 'location' && !location) return null;

  return {
    postId,
    kind,
    author,
    text: text || null,
    image: imageUrl
      ? {
          url: imageUrl,
          alt: imageAlt || 'Foto publicada na comunidade',
        }
      : null,
    location: kind === 'location' ? location : null,
    replyTo: normalizeReplyReference(source['replyTo']),
    metrics: {
      commentCount: normalizeCount(metrics['commentCount']),
      reactionCount: normalizeCount(metrics['reactionCount']),
    },
    capabilities: {
      canDeleteOwn: capabilities['canDeleteOwn'] === true,
      canModerate: capabilities['canModerate'] === true,
      canReport: capabilities['canReport'] === true,
      canReact: capabilities['canReact'] === true,
      viewerReacted: capabilities['viewerReacted'] === true,
      canViewComments: capabilities['canViewComments'] === true,
      canComment: capabilities['canComment'] === true,
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

export function normalizeCommunityFeedPostCreateResponse(
  raw: unknown
): CommunityFeedPostCreateResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const postId = normalizeSafeId(source['postId']);

  if (!communityId || !postId) {
    throw new Error('Resposta de publicação no Mural inválida.');
  }

  return {
    communityId,
    postId,
    created: source['created'] === true,
    deduplicated: source['deduplicated'] === true,
  };
}

export function normalizeCommunityFeedPostActionResponse(
  raw: unknown
): CommunityFeedPostActionResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const postId = normalizeSafeId(source['postId']);
  const action = source['action'];
  const status = source['status'];
  const generatedAt = Number(source['generatedAt']);

  if (
    !communityId
    || !postId
    || (action !== 'delete_own' && action !== 'remove')
    || (status !== 'deleted' && status !== 'removed')
    || !Number.isFinite(generatedAt)
  ) {
    throw new Error('Resposta de ação no Mural inválida.');
  }

  return {
    communityId,
    postId,
    action,
    status,
    deduplicated: source['deduplicated'] === true,
    generatedAt: Math.trunc(generatedAt),
  };
}

export function normalizeCommunityFeedReactionResponse(
  raw: unknown
): CommunityFeedReactionResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const postId = normalizeSafeId(source['postId']);
  const reactionCount = Number(source['reactionCount']);

  if (
    !communityId
    || !postId
    || typeof source['reacted'] !== 'boolean'
    || !Number.isFinite(reactionCount)
    || reactionCount < 0
  ) {
    throw new Error('Resposta de reação no Mural inválida.');
  }

  return {
    communityId,
    postId,
    reacted: source['reacted'] === true,
    reactionCount: Math.min(Math.trunc(reactionCount), 1_000_000_000),
  };
}

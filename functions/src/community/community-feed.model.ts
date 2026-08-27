// functions/src/community/community-feed.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED CONTRACTS
// -----------------------------------------------------------------------------
// Contratos sanitizados de leitura e publicação do mural comunitário. Texto e
// mídia pertencem à mesma timeline; respostas também são itens de primeira classe
// e carregam somente a referência segura à mensagem respondida.
//
// `media` é o contrato operacional atual. `image` permanece somente como leitura
// legada para posts já persistidos antes da migração para a camada canônica.
// -----------------------------------------------------------------------------

import { normalizePublishedMediaReference } from '../media/application/published-media-reference.model';
import type { CommunityPublicAuthor } from './community-public-author.model';

export type CommunityFeedView = 'feed' | 'photos';
export type CommunityFeedKind = 'text' | 'photo';
export type CommunityFeedAudience = 'public_preview' | 'members_only';

export interface CommunityFeedPageRequest {
  communityId?: unknown;
  view?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface CommunityFeedPostCreateRequest {
  requestId?: unknown;
  communityId?: unknown;
  text?: unknown;
  audience?: unknown;
  imageUploadPath?: unknown;
  replyToPostId?: unknown;
}

export interface NormalizedCommunityFeedPostCreateRequest {
  requestId: string | null;
  communityId: string | null;
  text: string;
  audience: CommunityFeedAudience;
  imageUploadPath: string | null;
  replyToPostId: string | null;
}

export interface CommunityFeedPostWriteResponse {
  communityId: string;
  postId: string;
  created: boolean;
  deduplicated: boolean;
}

export interface CommunityFeedItemCapabilities {
  canDeleteOwn: boolean;
  canModerate: boolean;
  canReport: boolean;
  canReact: boolean;
  viewerReacted: boolean;
  canViewComments: boolean;
  canComment: boolean;
}

export interface CommunityFeedReplyReference {
  postId: string;
  authorLabel: string;
  textPreview: string;
  available: boolean;
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
  author: CommunityPublicAuthor;
  text: string | null;
  image: {
    url: string;
    alt: string;
  } | null;
  replyTo: CommunityFeedReplyReference | null;
  metrics: {
    commentCount: number;
    reactionCount: number;
  };
  capabilities: CommunityFeedItemCapabilities;
  publishedAt: number;
}

export interface SanitizedCommunityFeedProjection {
  audience: CommunityFeedAudience;
  item: CommunityFeedItem;
  /** Somente backend: hidratado com URL temporária antes da resposta. */
  imageStoragePath: string | null;
  imageAlt: string | null;
  /** Somente backend: a citação pública é hidratada na leitura autorizada. */
  replyToPostId: string | null;
}

export interface CommunityFeedPageResponse {
  items: CommunityFeedItem[];
  nextCursor: string | null;
  generatedAt: number;
}

const DEFAULT_PAGE_LIMIT = 10;
const MAX_PAGE_LIMIT = 20;
const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
// Compatibilidade temporária para documentos legados que persistiam
// `image.storagePath` sem a referência canônica `media`.
const LEGACY_PUBLISHED_PHOTO_PATH_PATTERN =
  /^users\/[A-Za-z0-9_-]{1,128}\/published\/images\/[A-Za-z0-9:_-]{1,128}\/[^/]{1,220}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .split('')
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

function normalizeLegacyPublishedPhotoStoragePath(value: unknown): string | null {
  const normalized = normalizeText(value, 512).replace(/^\/+/, '');
  return LEGACY_PUBLISHED_PHOTO_PATH_PATTERN.test(normalized) ? normalized : null;
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

interface ProjectionPhotoSource {
  url: string | null;
  storagePath: string | null;
  alt: string;
  valid: boolean;
}

function resolveProjectionPhotoSource(
  source: Record<string, unknown>
): ProjectionPhotoSource {
  if (source['media'] != null) {
    const media = normalizePublishedMediaReference(source['media']);
    if (!media || media.mediaType !== 'PHOTO') {
      return {
        url: null,
        storagePath: null,
        alt: 'Foto publicada na comunidade',
        valid: false,
      };
    }

    return {
      url: null,
      storagePath: media.storagePath,
      alt: media.alt || 'Foto publicada na comunidade',
      valid: true,
    };
  }

  const image = (source['image'] ?? {}) as Record<string, unknown>;
  const imageUrl = normalizeHttpsUrl(image['url']);
  const imageStoragePath = normalizeLegacyPublishedPhotoStoragePath(
    image['storagePath']
  );
  const imageAlt = normalizeText(image['alt'], 140)
    || 'Foto publicada na comunidade';

  return {
    url: imageUrl,
    storagePath: imageStoragePath,
    alt: imageAlt,
    valid: !!imageUrl || !!imageStoragePath,
  };
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

export function normalizeCommunityFeedPostCreateRequest(
  raw: CommunityFeedPostCreateRequest | null | undefined
): NormalizedCommunityFeedPostCreateRequest {
  const imageUploadPath = normalizeText(raw?.imageUploadPath, 2_000);

  return {
    requestId: normalizeSafeId(raw?.requestId),
    communityId: normalizeSafeId(raw?.communityId),
    text: normalizeText(raw?.text, 1_000),
    audience: raw?.audience === 'public_preview'
      ? 'public_preview'
      : 'members_only',
    imageUploadPath: imageUploadPath || null,
    replyToPostId: normalizeSafeId(raw?.replyToPostId),
  };
}

export function sanitizeCommunityFeedProjection(
  documentId: string,
  raw: unknown,
  now = Date.now()
): SanitizedCommunityFeedProjection | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const author = (source['author'] ?? {}) as Record<string, unknown>;
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
  const rawReplyToPostId = normalizeText(source['replyToPostId'], 128);
  const replyToPostId = rawReplyToPostId
    ? normalizeSafeId(rawReplyToPostId)
    : null;

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
    || (rawReplyToPostId && (!replyToPostId || replyToPostId === postId))
  ) {
    return null;
  }

  const photoSource = resolveProjectionPhotoSource(source);

  if (kind === 'text' && text.length < 1) return null;
  if (kind === 'photo' && !photoSource.valid) return null;

  return {
    audience,
    imageStoragePath: kind === 'photo' ? photoSource.storagePath : null,
    imageAlt: kind === 'photo' ? photoSource.alt : null,
    replyToPostId,
    item: {
      postId,
      kind,
      author: {
        label: authorLabel,
        avatarUrl: normalizeHttpsUrl(author['avatarUrl']),
        profileType: null,
        profileTypeLabel: null,
        city: null,
        state: null,
      },
      text: text || null,
      image: kind === 'photo' && photoSource.url
        ? {
          url: photoSource.url,
          alt: photoSource.alt,
        }
        : null,
      replyTo: null,
      metrics: {
        commentCount: normalizeCount(metrics['commentCount']),
        reactionCount: normalizeCount(metrics['reactionCount']),
      },
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
        canReact: false,
        viewerReacted: false,
        canViewComments: false,
        canComment: false,
      },
      publishedAt,
    },
  };
}

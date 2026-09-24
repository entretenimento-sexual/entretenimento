// functions/src/community/community-explore-content.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY CONTENT DISTRIBUTION PROJECTION
// -----------------------------------------------------------------------------
// Projeção backend-only para distribuir uma amostra estritamente pública do
// Mural no Explore. Não é um segundo Mural: respostas, localização, conteúdo
// members_only, capacidades e identificadores privados ficam fora do contrato.
// -----------------------------------------------------------------------------

import {
  sanitizeCommunityFeedProjection,
  type CommunityFeedItem,
} from './community-feed.model';
import {
  sanitizeCommunityDiscoveryProjection,
} from './community-preview.model';

export const COMMUNITY_EXPLORE_CONTENT_RETENTION_MS =
  14 * 24 * 60 * 60 * 1_000;

export type CommunityExploreContentKind = 'text' | 'photo';

export interface CommunityExploreContentItem {
  readonly communityId: string;
  readonly postId: string;
  readonly community: {
    readonly name: string;
    readonly slug: string;
    readonly avatarUrl: string | null;
  };
  readonly post: {
    readonly kind: CommunityExploreContentKind;
    readonly author: CommunityFeedItem['author'];
    readonly text: string | null;
    readonly image: {
      readonly url: string;
      readonly alt: string;
    } | null;
  };
  readonly publishedAt: number;
}

export interface CommunityExploreContentResponse {
  readonly items: readonly CommunityExploreContentItem[];
  readonly generatedAt: number;
}

export interface CommunityExploreContentProjection {
  readonly communityId: string;
  readonly postId: string;
  readonly actorUid: string;
  readonly community: {
    readonly name: string;
    readonly slug: string;
    readonly avatarUrl: string | null;
  };
  readonly post: {
    readonly kind: CommunityExploreContentKind;
    readonly author: CommunityFeedItem['author'];
    readonly text: string | null;
    readonly imageAlt: string | null;
    readonly imageStoragePath: string | null;
  };
  readonly publishedAt: number;
  readonly expiresAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeEpoch(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  }

  if (value && typeof value === 'object') {
    const timestamp = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };
    if (typeof timestamp.toMillis === 'function') {
      const millis = Number(timestamp.toMillis());
      return Number.isFinite(millis) && millis > 0 ? Math.trunc(millis) : null;
    }
    const seconds = Number(timestamp.seconds);
    const nanoseconds = Number(timestamp.nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      const millis = seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
      return Number.isFinite(millis) && millis > 0 ? Math.trunc(millis) : null;
    }
  }

  return null;
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function communityExploreContentSourceFingerprint(raw: unknown): string {
  const source = (raw ?? {}) as Record<string, unknown>;
  const author = (source['author'] ?? {}) as Record<string, unknown>;
  const image = (source['image'] ?? {}) as Record<string, unknown>;

  return JSON.stringify({
    kind: source['kind'] ?? null,
    audience: source['audience'] ?? null,
    status: source['status'] ?? null,
    moderationState: source['moderationState'] ?? null,
    authorLabel: author['label'] ?? null,
    authorAvatarUrl: author['avatarUrl'] ?? null,
    text: source['text'] ?? null,
    imageStoragePath: image['storagePath'] ?? null,
    imageAlt: image['alt'] ?? null,
    replyToPostId: source['replyToPostId'] ?? null,
    publishedAt: normalizeEpoch(source['publishedAt']),
    expiresAt: normalizeEpoch(source['expiresAt']),
  });
}

export function buildCommunityExploreContentProjection(input: {
  communityId: unknown;
  postId: unknown;
  discovery: unknown;
  feed: unknown;
  operationalPost: unknown;
  now?: number;
}): CommunityExploreContentProjection | null {
  const now = input.now ?? Date.now();
  const communityId = normalizeSafeId(input.communityId);
  const postId = normalizeSafeId(input.postId);
  const community = communityId
    ? sanitizeCommunityDiscoveryProjection(communityId, input.discovery)
    : null;
  const feed = postId
    ? sanitizeCommunityFeedProjection(postId, input.feed, now)
    : null;
  const operationalPost = (input.operationalPost ?? {}) as Record<string, unknown>;
  const actorUid = normalizeSafeId(operationalPost['actorUid']);

  if (
    !communityId
    || !postId
    || !community
    || community.source.type !== 'community'
    || !feed
    || feed.audience !== 'public_preview'
    || feed.replyToPostId !== null
    || (feed.item.kind !== 'text' && feed.item.kind !== 'photo')
    || !actorUid
    || operationalPost['status'] !== 'active'
    || operationalPost['moderationState'] !== 'active'
  ) {
    return null;
  }

  const publishedAt = feed.item.publishedAt;
  if (
    !Number.isFinite(publishedAt)
    || publishedAt <= 0
    || publishedAt < now - COMMUNITY_EXPLORE_CONTENT_RETENTION_MS
  ) {
    return null;
  }

  if (
    feed.item.kind === 'photo'
    && !feed.imageStoragePath
    && !feed.item.image?.url
  ) {
    return null;
  }

  return {
    communityId,
    postId,
    actorUid,
    community: {
      name: community.name,
      slug: community.slug,
      avatarUrl: community.avatarUrl,
    },
    post: {
      kind: feed.item.kind,
      author: feed.item.author,
      text: feed.item.text,
      imageAlt: feed.item.kind === 'photo'
        ? feed.imageAlt || feed.item.image?.alt || 'Foto publicada na comunidade'
        : null,
      imageStoragePath: feed.item.kind === 'photo'
        ? feed.imageStoragePath
        : null,
    },
    publishedAt,
    expiresAt: publishedAt + COMMUNITY_EXPLORE_CONTENT_RETENTION_MS,
  };
}

export function sanitizeCommunityExploreContentProjection(
  raw: unknown,
  now = Date.now()
): CommunityExploreContentProjection | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const community = (source['community'] ?? {}) as Record<string, unknown>;
  const post = (source['post'] ?? {}) as Record<string, unknown>;
  const author = (post['author'] ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const postId = normalizeSafeId(source['postId']);
  const actorUid = normalizeSafeId(source['actorUid']);
  const name = normalizeText(community['name'], 80);
  const slug = normalizeText(community['slug'], 100);
  const kind = post['kind'];
  const authorLabel = normalizeText(author['label'], 60);
  const publishedAt = normalizeEpoch(source['publishedAt']);
  const expiresAt = normalizeEpoch(source['expiresAt']);
  const imageStoragePath = normalizeText(post['imageStoragePath'], 512);

  if (
    !communityId
    || !postId
    || !actorUid
    || name.length < 2
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    || (kind !== 'text' && kind !== 'photo')
    || authorLabel.length < 2
    || !publishedAt
    || !expiresAt
    || expiresAt <= now
    || publishedAt > now + 5 * 60_000
  ) {
    return null;
  }

  const text = normalizeText(post['text'], 1_000);
  if (kind === 'text' && !text) return null;
  if (kind === 'photo' && !imageStoragePath) return null;

  return {
    communityId,
    postId,
    actorUid,
    community: {
      name,
      slug,
      avatarUrl: normalizeHttpsUrl(community['avatarUrl']),
    },
    post: {
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
      imageAlt: kind === 'photo'
        ? normalizeText(post['imageAlt'], 140) || 'Foto publicada na comunidade'
        : null,
      imageStoragePath: kind === 'photo' ? imageStoragePath : null,
    },
    publishedAt,
    expiresAt,
  };
}

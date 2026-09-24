// src/app/community/data-access/community-explore-content.model.ts
import {
  type CommunityPublicAuthor,
  normalizeCommunityPublicAuthor,
} from './community-public-author.model';

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
    readonly author: CommunityPublicAuthor;
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

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

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

function normalizeEpoch(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function normalizeItem(raw: unknown): CommunityExploreContentItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const community = (source['community'] ?? {}) as Record<string, unknown>;
  const post = (source['post'] ?? {}) as Record<string, unknown>;
  const image = (post['image'] ?? {}) as Record<string, unknown>;
  const communityId = normalizeSafeId(source['communityId']);
  const postId = normalizeSafeId(source['postId']);
  const name = normalizeText(community['name'], 80);
  const slug = normalizeText(community['slug'], 100);
  const kind = post['kind'];
  const author = normalizeCommunityPublicAuthor(post['author']);
  const publishedAt = normalizeEpoch(source['publishedAt']);
  const text = normalizeText(post['text'], 1_000);

  if (
    !communityId
    || !postId
    || name.length < 2
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    || (kind !== 'text' && kind !== 'photo')
    || !author
    || !publishedAt
    || (kind === 'text' && !text)
  ) {
    return null;
  }

  const imageUrl = normalizeHttpsUrl(image['url']);
  if (kind === 'photo' && !imageUrl) return null;

  return {
    communityId,
    postId,
    community: {
      name,
      slug,
      avatarUrl: normalizeHttpsUrl(community['avatarUrl']),
    },
    post: {
      kind,
      author,
      text: text || null,
      image: imageUrl
        ? {
            url: imageUrl,
            alt:
              normalizeText(image['alt'], 140)
              || 'Foto publicada na comunidade',
          }
        : null,
    },
    publishedAt,
  };
}

export function normalizeCommunityExploreContentResponse(
  raw: unknown
): CommunityExploreContentResponse {
  const source = (raw ?? {}) as Record<string, unknown>;
  const generatedAt = normalizeEpoch(source['generatedAt']) ?? Date.now();

  return {
    items: Array.isArray(source['items'])
      ? source['items']
          .map(normalizeItem)
          .filter((item): item is CommunityExploreContentItem => item !== null)
          .slice(0, 2)
      : [],
    generatedAt,
  };
}

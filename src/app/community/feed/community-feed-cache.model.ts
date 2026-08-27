// src/app/community/feed/community-feed-cache.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED CACHE SCOPE
// -----------------------------------------------------------------------------
// O Mural hidratado é específico do viewer: capabilities, viewerReacted e URLs
// temporárias não podem atravessar sessões. A chave inclui UID + Comunidade + view.
// -----------------------------------------------------------------------------

import type { CommunityFeedView } from '../data-access/community-feed.model';

export interface CommunityFeedCacheQuery {
  readonly viewerUid: string;
  readonly communityId: string;
  readonly view: CommunityFeedView;
}

export const COMMUNITY_FEED_CACHE_SOFT_TTL_MS = 30_000;
export const COMMUNITY_FEED_CACHE_HARD_TTL_MS = 5 * 60_000;
export const COMMUNITY_FEED_CACHE_MAX_SCOPES = 6;

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const COMMUNITY_FEED_CACHE_PREFIX = 'community:feed:v1';

function normalizeSafeId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
}

export function buildCommunityFeedCacheQuery(
  viewerUidValue: unknown,
  communityIdValue: unknown,
  viewValue: unknown
): CommunityFeedCacheQuery | null {
  const viewerUid = normalizeSafeId(viewerUidValue);
  const communityId = normalizeSafeId(communityIdValue);
  const view: CommunityFeedView = viewValue === 'photos' ? 'photos' : 'feed';

  return viewerUid && communityId
    ? { viewerUid, communityId, view }
    : null;
}

export function buildCommunityFeedCacheKey(
  query: CommunityFeedCacheQuery
): string {
  const normalized = buildCommunityFeedCacheQuery(
    query.viewerUid,
    query.communityId,
    query.view
  );

  if (!normalized) {
    return `${COMMUNITY_FEED_CACHE_PREFIX}|scope=invalid`;
  }

  return [
    COMMUNITY_FEED_CACHE_PREFIX,
    `viewer=${normalized.viewerUid}`,
    `community=${normalized.communityId}`,
    `view=${normalized.view}`,
  ].join('|');
}

export function communityFeedCacheAgeMs(
  lastLoadedAt: number,
  now = Date.now()
): number | null {
  if (
    !Number.isFinite(lastLoadedAt)
    || lastLoadedAt <= 0
    || !Number.isFinite(now)
  ) {
    return null;
  }

  return Math.max(0, Math.trunc(now) - Math.trunc(lastLoadedAt));
}

export function isCommunityFeedCacheSoftFresh(
  lastLoadedAt: number,
  now = Date.now()
): boolean {
  const age = communityFeedCacheAgeMs(lastLoadedAt, now);
  return age !== null && age < COMMUNITY_FEED_CACHE_SOFT_TTL_MS;
}

export function isCommunityFeedCacheHardExpired(
  lastLoadedAt: number,
  now = Date.now()
): boolean {
  const age = communityFeedCacheAgeMs(lastLoadedAt, now);
  return age !== null && age >= COMMUNITY_FEED_CACHE_HARD_TTL_MS;
}

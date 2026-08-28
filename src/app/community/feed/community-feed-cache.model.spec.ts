import { describe, expect, it } from 'vitest';

import {
  COMMUNITY_FEED_CACHE_HARD_TTL_MS,
  COMMUNITY_FEED_CACHE_SOFT_TTL_MS,
  buildCommunityFeedCacheKey,
  buildCommunityFeedCacheQuery,
  isCommunityFeedCacheHardExpired,
  isCommunityFeedCacheSoftFresh,
} from './community-feed-cache.model';

describe('community feed cache scope', () => {
  it('isola a mesma Comunidade por viewer e visualização', () => {
    const feedA = buildCommunityFeedCacheQuery('user-a', 'community-1', 'feed');
    const feedB = buildCommunityFeedCacheQuery('user-b', 'community-1', 'feed');
    const photosA = buildCommunityFeedCacheQuery('user-a', 'community-1', 'photos');

    expect(feedA).not.toBeNull();
    expect(feedB).not.toBeNull();
    expect(photosA).not.toBeNull();
    expect(buildCommunityFeedCacheKey(feedA!)).not.toBe(
      buildCommunityFeedCacheKey(feedB!)
    );
    expect(buildCommunityFeedCacheKey(feedA!)).not.toBe(
      buildCommunityFeedCacheKey(photosA!)
    );
  });

  it('rejeita viewer ou communityId inseguros', () => {
    expect(buildCommunityFeedCacheQuery('../user', 'community-1', 'feed')).toBeNull();
    expect(buildCommunityFeedCacheQuery('user-1', '../community', 'feed')).toBeNull();
    expect(buildCommunityFeedCacheQuery(null, 'community-1', 'feed')).toBeNull();
  });

  it('aplica soft TTL sem ultrapassar o hard TTL', () => {
    const now = 1_800_000_000_000;

    expect(isCommunityFeedCacheSoftFresh(now, now)).toBe(true);
    expect(isCommunityFeedCacheSoftFresh(
      now - COMMUNITY_FEED_CACHE_SOFT_TTL_MS + 1,
      now
    )).toBe(true);
    expect(isCommunityFeedCacheSoftFresh(
      now - COMMUNITY_FEED_CACHE_SOFT_TTL_MS,
      now
    )).toBe(false);

    expect(isCommunityFeedCacheHardExpired(
      now - COMMUNITY_FEED_CACHE_HARD_TTL_MS + 1,
      now
    )).toBe(false);
    expect(isCommunityFeedCacheHardExpired(
      now - COMMUNITY_FEED_CACHE_HARD_TTL_MS,
      now
    )).toBe(true);
  });
});

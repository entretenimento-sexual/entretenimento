import { describe, expect, it } from 'vitest';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { buildExplorePersonalFeed } from './explore-personal-feed';

function photo(
  id: string,
  ownerUid: string,
  overrides: Partial<IPublicPhotoItem> = {}
): IPublicPhotoItem {
  return {
    id,
    ownerUid,
    url: `https://example.test/${id}.webp`,
    createdAt: 1,
    publishedAt: 1,
    visibility: 'PUBLIC',
    orderIndex: 0,
    ...overrides,
  } as IPublicPhotoItem;
}

describe('buildExplorePersonalFeed', () => {
  it('remove duplicidades entre as seções públicas', () => {
    const repeated = photo('p1', 'u1', { publishedAt: 10 });

    const result = buildExplorePersonalFeed({
      boostedPhotos: [repeated],
      mostViewedPhotos: [repeated],
      topPhotos: [repeated],
      latestPhotos: [repeated],
      compatibleProfiles: [],
    });

    expect(result).toEqual([repeated]);
  });

  it('prioriza autores compatíveis antes de publicações comuns', () => {
    const common = photo('common', 'u1', { publishedAt: 1000 });
    const compatible = photo('compatible', 'u2', { publishedAt: 1 });

    const result = buildExplorePersonalFeed({
      boostedPhotos: [],
      mostViewedPhotos: [],
      topPhotos: [common],
      latestPhotos: [compatible],
      compatibleProfiles: [{ uid: 'u2', nickname: 'Compatível' }],
    });

    expect(result[0]?.id).toBe('compatible');
  });

  it('limita repetição por autor para preservar diversidade', () => {
    const result = buildExplorePersonalFeed(
      {
        boostedPhotos: [],
        mostViewedPhotos: [],
        topPhotos: [],
        latestPhotos: [
          photo('a1', 'u1', { publishedAt: 6 }),
          photo('a2', 'u1', { publishedAt: 5 }),
          photo('a3', 'u1', { publishedAt: 4 }),
          photo('b1', 'u2', { publishedAt: 3 }),
        ],
        compatibleProfiles: [],
      },
      { maxItemsPerOwner: 2 }
    );

    expect(result.map((item) => item.id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('respeita o limite total da timeline', () => {
    const result = buildExplorePersonalFeed(
      {
        boostedPhotos: [],
        mostViewedPhotos: [],
        topPhotos: [],
        latestPhotos: [
          photo('a', 'u1', { publishedAt: 3 }),
          photo('b', 'u2', { publishedAt: 2 }),
          photo('c', 'u3', { publishedAt: 1 }),
        ],
        compatibleProfiles: [],
      },
      { limit: 2 }
    );

    expect(result.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

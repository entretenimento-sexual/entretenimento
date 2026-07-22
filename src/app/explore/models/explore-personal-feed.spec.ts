import { describe, expect, it } from 'vitest';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import {
  buildExplorePersonalFeed,
  buildExplorePersonalFeedWindow,
} from './explore-personal-feed';

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
  it('remove duplicidades entre as fontes autorizadas', () => {
    const repeated = photo('p1', 'u1', { publishedAt: 10 });

    const result = buildExplorePersonalFeed({
      personalPhotos: [repeated],
      boostedPhotos: [repeated],
      mostViewedPhotos: [repeated],
      topPhotos: [repeated],
      latestPhotos: [repeated],
      compatibleProfiles: [],
      friendUids: [],
    });

    expect(result).toEqual([repeated]);
  });

  it('prioriza amigos antes de perfis compatíveis', () => {
    const friend = photo('friend', 'friend-1', { publishedAt: 1 });
    const compatible = photo('compatible', 'compatible-1', {
      publishedAt: 10_000,
      boostActive: true,
      boostPriority: 999,
    });

    const result = buildExplorePersonalFeed({
      personalPhotos: [compatible, friend],
      boostedPhotos: [compatible],
      mostViewedPhotos: [],
      topPhotos: [],
      latestPhotos: [],
      compatibleProfiles: [
        { uid: 'compatible-1', nickname: 'Compatível' },
      ],
      friendUids: ['friend-1'],
    });

    expect(result.map((item) => item.id)).toEqual(['friend', 'compatible']);
  });

  it('prioriza perfis compatíveis antes de publicações comuns', () => {
    const common = photo('common', 'u1', { publishedAt: 1000 });
    const compatible = photo('compatible', 'u2', { publishedAt: 1 });

    const result = buildExplorePersonalFeed({
      personalPhotos: [compatible],
      boostedPhotos: [],
      mostViewedPhotos: [],
      topPhotos: [common],
      latestPhotos: [compatible],
      compatibleProfiles: [{ uid: 'u2', nickname: 'Compatível' }],
      friendUids: [],
    });

    expect(result.map((item) => item.id)).toEqual(['compatible']);
  });

  it('remove autores sem vínculo quando há amigos ou compatíveis resolvidos', () => {
    const friend = photo('friend', 'friend-1', { publishedAt: 3 });
    const compatible = photo('compatible', 'compatible-1', { publishedAt: 2 });
    const unrelated = photo('unrelated', 'other-1', { publishedAt: 9_999 });

    const result = buildExplorePersonalFeed({
      personalPhotos: [friend, compatible],
      boostedPhotos: [unrelated],
      mostViewedPhotos: [],
      topPhotos: [],
      latestPhotos: [unrelated],
      compatibleProfiles: [
        { uid: 'compatible-1', nickname: 'Compatível' },
      ],
      friendUids: ['friend-1'],
    });

    expect(result.map((item) => item.id)).toEqual(['friend', 'compatible']);
  });

  it('usa recência dentro do mesmo grupo antes de impulso e engajamento', () => {
    const recent = photo('recent', 'friend-1', { publishedAt: 100 });
    const oldBoosted = photo('old-boosted', 'friend-2', {
      publishedAt: 1,
      boostActive: true,
      boostPriority: 500,
      reactionsCount: 10_000,
    });

    const result = buildExplorePersonalFeed({
      personalPhotos: [oldBoosted, recent],
      boostedPhotos: [oldBoosted],
      mostViewedPhotos: [],
      topPhotos: [],
      latestPhotos: [],
      compatibleProfiles: [],
      friendUids: ['friend-1', 'friend-2'],
    });

    expect(result.map((item) => item.id)).toEqual(['recent', 'old-boosted']);
  });

  it('limita repetição por autor para preservar diversidade', () => {
    const result = buildExplorePersonalFeed(
      {
        personalPhotos: [],
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
        friendUids: [],
      },
      { maxItemsPerOwner: 2 }
    );

    expect(result.map((item) => item.id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('respeita o limite total da timeline', () => {
    const result = buildExplorePersonalFeed(
      {
        personalPhotos: [],
        boostedPhotos: [],
        mostViewedPhotos: [],
        topPhotos: [],
        latestPhotos: [
          photo('a', 'u1', { publishedAt: 3 }),
          photo('b', 'u2', { publishedAt: 2 }),
          photo('c', 'u3', { publishedAt: 1 }),
        ],
        compatibleProfiles: [],
        friendUids: [],
      },
      { limit: 2 }
    );

    expect(result.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('buildExplorePersonalFeedWindow', () => {
  const items = [
    photo('a', 'u1'),
    photo('b', 'u2'),
    photo('c', 'u3'),
    photo('d', 'u4'),
  ];

  it('expõe somente a janela solicitada e informa o restante', () => {
    const result = buildExplorePersonalFeedWindow(items, 2);

    expect(result.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.visibleCount).toBe(2);
    expect(result.totalItems).toBe(4);
    expect(result.remainingItems).toBe(2);
    expect(result.hasMore).toBe(true);
  });

  it('limita a janela ao total disponível', () => {
    const result = buildExplorePersonalFeedWindow(items, 10);

    expect(result.items).toHaveLength(4);
    expect(result.visibleCount).toBe(4);
    expect(result.remainingItems).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('mantém estado vazio estável', () => {
    expect(buildExplorePersonalFeedWindow([], 6)).toEqual({
      items: [],
      visibleCount: 0,
      totalItems: 0,
      remainingItems: 0,
      hasMore: false,
    });
  });
});

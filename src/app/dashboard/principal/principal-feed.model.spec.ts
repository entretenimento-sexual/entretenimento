// src/app/dashboard/principal/principal-feed.model.spec.ts
import { describe, expect, it } from 'vitest';

import type { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { buildPrincipalFeedItems } from './principal-feed.model';

function photo(
  id: string,
  publishedAt: number,
  ownerUid = `owner-${id}`
): IPublicPhotoItem {
  return {
    id,
    ownerUid,
    url: `https://example.com/${id}.jpg`,
    createdAt: publishedAt,
    publishedAt,
    visibility: 'PUBLIC',
    orderIndex: 0,
  } as IPublicPhotoItem;
}

function space(
  id: string,
  type: 'community' | 'venue'
): CommunityPreviewCard {
  return {
    communityId: id,
    name: `${type}-${id}`,
    slug: `${type}-${id}`,
    description: null,
    source: { type, id },
    avatarUrl: null,
    coverUrl: null,
    metrics: {
      memberCount: 0,
      postCount: 0,
      mediaCount: 0,
    },
    access: {
      join: 'open',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
  };
}

describe('buildPrincipalFeedItems', () => {
  it('ordena atualizações por publicação e insere descoberta após duas fotos', () => {
    const items = buildPrincipalFeedItems(
      [photo('old', 100), photo('new', 300), photo('middle', 200)],
      [space('c1', 'community')],
      [space('v1', 'venue')]
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-photo:new',
      'profile-photo:middle',
      'community:c1',
      'profile-photo:old',
      'venue:v1',
    ]);
  });

  it('alterna Comunidades e Locais quando não há mídia pública', () => {
    const items = buildPrincipalFeedItems(
      [],
      [space('c1', 'community'), space('c2', 'community')],
      [space('v1', 'venue'), space('v2', 'venue')]
    );

    expect(items.map((item) => item.kind)).toEqual([
      'community',
      'venue',
      'community',
      'venue',
    ]);
  });

  it('descarta mídia inválida, remove duplicados e respeita o limite', () => {
    const invalid = {
      ...photo('invalid', 500),
      url: '',
    } as IPublicPhotoItem;

    const items = buildPrincipalFeedItems(
      [photo('p1', 100), photo('p1', 200), invalid],
      [space('c1', 'community'), space('c1', 'community')],
      [],
      2
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-photo:p1',
      'community:c1',
    ]);
  });
});

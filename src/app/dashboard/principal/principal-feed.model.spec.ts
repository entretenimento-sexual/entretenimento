// src/app/dashboard/principal/principal-feed.model.spec.ts
import { describe, expect, it } from 'vitest';

import type { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
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

function video(
  id: string,
  publishedAt: number,
  ownerUid = `owner-${id}`
): IPublicVideoItem {
  return {
    id,
    ownerUid,
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'NONE',
    title: `Vídeo ${id}`,
    description: null,
    alt: `Vídeo ${id}`,
    mimeType: 'video/mp4',
    sizeBytes: 2_048,
    durationMs: 10_000,
    createdAt: publishedAt,
    publishedAt,
    updatedAt: publishedAt,
    lastViewedAt: null,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    moderationReason: null,
    reactionsEnabled: true,
    commentsEnabled: true,
    ratingsEnabled: true,
    viewsCount: 0,
    uniqueViewersCount: 0,
    reactionsCount: 0,
    commentsCount: 0,
    ratingsCount: 0,
    ratingAverage: 0,
    reportsCount: 0,
    openReportsCount: 0,
    confirmedReportsCount: 0,
    viewScore: 0,
    engagementScore: 0,
    score: 0,
    scoreBreakdown: {
      rankingScore: 0,
      qualityScore: 0,
      engagementScore: 0,
      safetyScore: 100,
    },
    owner: null,
    url: `https://example.com/${id}.mp4`,
    posterUrl: null,
    accessExpiresAt: publishedAt + 60_000,
  };
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
  it('intercala fotos e vídeos por data e insere descoberta depois de três mídias', () => {
    const items = buildPrincipalFeedItems(
      [photo('old', 100), photo('new', 300), photo('middle', 200)],
      [video('v1', 250)],
      [space('c1', 'community')],
      [space('v1', 'venue')]
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-photo:owner-new:new',
      'profile-video:owner-v1:v1',
      'profile-photo:owner-middle:middle',
      'community:c1',
      'profile-photo:owner-old:old',
      'venue:v1',
    ]);
  });

  it('alterna Comunidades e Locais quando não há mídia pública', () => {
    const items = buildPrincipalFeedItems(
      [],
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
    const invalidPhoto = {
      ...photo('invalid', 500),
      url: '',
    } as IPublicPhotoItem;
    const invalidVideo = {
      ...video('invalid-video', 600),
      url: '',
    } as IPublicVideoItem;

    const items = buildPrincipalFeedItems(
      [photo('p1', 100), photo('p1', 200), invalidPhoto],
      [video('v1', 300), video('v1', 400), invalidVideo],
      [space('c1', 'community'), space('c1', 'community')],
      [],
      2
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-video:owner-v1:v1',
      'profile-photo:owner-p1:p1',
    ]);
  });
});

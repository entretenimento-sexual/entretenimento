// src/app/dashboard/principal/principal-feed.model.spec.ts
import { describe, expect, it } from 'vitest';

import type { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { buildPublicMediaIdentity } from 'src/app/core/utils/media/public-media-identity';
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
    posterAccess: 'SIGNED_URL',
    title: `Vídeo ${id}`,
    description: null,
    alt: `Vídeo ${id}`,
    mimeType: 'video/mp4',
    sizeBytes: 1_024,
    durationMs: 20_000,
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
    url: null,
    posterUrl: `https://example.com/${id}.jpg`,
    accessExpiresAt: publishedAt + 300_000,
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
    tags: [],
  };
}

describe('buildPrincipalFeedItems', () => {
  it('mistura fotos e vídeos por publicação e insere descoberta após duas mídias', () => {
    const items = buildPrincipalFeedItems(
      [photo('old', 100), photo('new', 300)],
      [video('middle', 200)],
      [space('c1', 'community')],
      [space('v1', 'venue')]
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-photo:owner-new:new',
      'profile-video:owner-middle:middle',
      'community:c1',
      'profile-photo:owner-old:old',
      'venue:v1',
    ]);
  });

  it('limita prioridade de conexões a um slot a cada três mídias enquanto há global', () => {
    const items = buildPrincipalFeedItems(
      [
        photo('global-1', 600, 'global-a'),
        photo('friend-1', 300, 'friend-a'),
        photo('global-2', 500, 'global-b'),
      ],
      [
        video('friend-2', 200, 'friend-b'),
        video('global-3', 400, 'global-c'),
      ],
      [],
      [],
      10,
      ['friend-a', 'friend-b']
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-photo:friend-a:friend-1',
      'profile-photo:global-a:global-1',
      'profile-photo:global-b:global-2',
      'profile-video:friend-b:friend-2',
      'profile-video:global-c:global-3',
    ]);
  });

  it('compartilha o teto de um terço entre conexões e compatíveis sem reduzir a parcela global', () => {
    const items = buildPrincipalFeedItems(
      [
        photo('global-1', 1_000, 'global-a'),
        photo('global-2', 900, 'global-b'),
        photo('global-3', 800, 'global-c'),
        photo('global-4', 700, 'global-d'),
        photo('friend-1', 600, 'friend-a'),
        photo('compatible-1', 550, 'compatible-a'),
      ],
      [
        video('friend-2', 500, 'friend-b'),
        video('compatible-2', 400, 'compatible-b'),
      ],
      [],
      [],
      10,
      ['friend-a', 'friend-b'],
      ['compatible-a', 'compatible-b']
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-photo:friend-a:friend-1',
      'profile-photo:global-a:global-1',
      'profile-photo:global-b:global-2',
      'profile-photo:compatible-a:compatible-1',
      'profile-photo:global-c:global-3',
      'profile-photo:global-d:global-4',
      'profile-video:friend-b:friend-2',
      'profile-video:compatible-b:compatible-2',
    ]);
  });

  it('trata perfil que também é compatível como conexão sem duplicar prioridade', () => {
    const items = buildPrincipalFeedItems(
      [
        photo('dual', 300, 'dual-owner'),
        photo('compatible', 250, 'compatible-owner'),
        photo('global-1', 500, 'global-a'),
        photo('global-2', 400, 'global-b'),
        photo('global-3', 200, 'global-c'),
        photo('global-4', 100, 'global-d'),
      ],
      [],
      [],
      [],
      10,
      ['dual-owner'],
      ['dual-owner', 'compatible-owner']
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-photo:dual-owner:dual',
      'profile-photo:global-a:global-1',
      'profile-photo:global-b:global-2',
      'profile-photo:compatible-owner:compatible',
      'profile-photo:global-c:global-3',
      'profile-photo:global-d:global-4',
    ]);
    expect(
      items.filter((item) => item.id === 'profile-photo:dual-owner:dual')
    ).toHaveLength(1);
  });

  it('adia foto e vídeo vistos recentemente sem removê-los do feed', () => {
    const recentPhoto = photo('recent-photo', 500, 'owner-photo');
    const unseenPhoto = photo('unseen-photo', 300, 'owner-unseen-photo');
    const recentVideo = video('recent-video', 400, 'owner-video');
    const unseenVideo = video('unseen-video', 200, 'owner-unseen-video');
    const recentViewedKeys = [
      buildPublicMediaIdentity('PHOTO', recentPhoto.ownerUid, recentPhoto.id),
      buildPublicMediaIdentity('VIDEO', recentVideo.ownerUid, recentVideo.id),
    ];

    const items = buildPrincipalFeedItems(
      [recentPhoto, unseenPhoto],
      [recentVideo, unseenVideo],
      [],
      [],
      10,
      [],
      [],
      recentViewedKeys
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-photo:owner-unseen-photo:unseen-photo',
      'profile-video:owner-unseen-video:unseen-video',
      'profile-photo:owner-photo:recent-photo',
      'profile-video:owner-video:recent-video',
    ]);
    expect(items).toHaveLength(4);
  });

  it('mantém cronologia quando todas as mídias do bucket foram vistas recentemente', () => {
    const first = photo('first', 300, 'owner-a');
    const second = video('second', 200, 'owner-b');
    const recentViewedKeys = [
      buildPublicMediaIdentity('PHOTO', first.ownerUid, first.id),
      buildPublicMediaIdentity('VIDEO', second.ownerUid, second.id),
    ];

    const items = buildPrincipalFeedItems(
      [first],
      [second],
      [],
      [],
      10,
      [],
      [],
      recentViewedKeys
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-photo:owner-a:first',
      'profile-video:owner-b:second',
    ]);
  });

  it('preserva ordem cronológica quando não há owners prioritários', () => {
    const items = buildPrincipalFeedItems(
      [photo('p1', 100, 'owner-a')],
      [video('v1', 300, 'owner-b'), video('v2', 200, 'owner-c')],
      [],
      [],
      10,
      []
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-video:owner-b:v1',
      'profile-video:owner-c:v2',
      'profile-photo:owner-a:p1',
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

  it('deduplica pela identidade composta sem colidir mídias de perfis distintos', () => {
    const items = buildPrincipalFeedItems(
      [
        photo('shared-id', 100, 'owner-a'),
        photo('shared-id', 200, 'owner-b'),
        photo('shared-id', 300, 'owner-b'),
      ],
      [
        video('shared-video', 150, 'owner-a'),
        video('shared-video', 250, 'owner-b'),
      ],
      [],
      []
    );

    expect(items.map((item) => item.id)).toEqual([
      'profile-photo:owner-b:shared-id',
      'profile-video:owner-b:shared-video',
      'profile-video:owner-a:shared-video',
      'profile-photo:owner-a:shared-id',
    ]);
  });

  it('descarta mídia inválida e respeita o limite', () => {
    const invalidPhoto = {
      ...photo('invalid', 500),
      url: '',
    } as IPublicPhotoItem;
    const invalidVideo = {
      ...video('invalid-video', 600),
      mediaType: 'PHOTO',
    } as unknown as IPublicVideoItem;

    const items = buildPrincipalFeedItems(
      [photo('p1', 100), invalidPhoto],
      [video('v1', 200), invalidVideo],
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
import { describe, expect, it } from 'vitest';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { buildExplorePersonalFeed } from './explore-personal-feed';
import { buildExploreSocialFeed } from './explore-social-feed';

function photo(id: string, ownerUid: string): IPublicPhotoItem {
  return {
    id,
    ownerUid,
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    url: `https://example.test/${id}.webp`,
    createdAt: 100,
    publishedAt: 100,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
  } as IPublicPhotoItem;
}

function video(id: string, ownerUid: string): IPublicVideoItem {
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
    durationMs: 12_000,
    createdAt: 200,
    publishedAt: 200,
    updatedAt: 200,
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
    posterUrl: `https://example.test/${id}.webp?preview=1`,
    accessExpiresAt: Date.now() + 60_000,
  };
}

describe('compatíveis paginados no Explore', () => {
  it('mantém foto de compatível fora da janela visual de perfis', () => {
    const remotePhoto = photo('remote-photo', 'compatible-13');
    const unrelated = photo('unrelated', 'other-1');

    const result = buildExplorePersonalFeed({
      personalPhotos: [remotePhoto, unrelated],
      boostedPhotos: [],
      mostViewedPhotos: [],
      topPhotos: [],
      latestPhotos: [],
      compatibleProfiles: [
        { uid: 'compatible-1', nickname: 'Visual' },
      ],
      compatibleOwnerUids: ['compatible-1', 'compatible-13'],
      friendUids: [],
    });

    expect(result.map((item) => item.id)).toEqual(['remote-photo']);
  });

  it('classifica vídeo de compatível paginado mesmo sem card visual correspondente', () => {
    const remoteVideo = video('remote-video', 'compatible-13');

    const result = buildExploreSocialFeed(
      [],
      [],
      [],
      [{ uid: 'compatible-1', nickname: 'Visual' }],
      {
        viewerUid: 'viewer-1',
        videos: [remoteVideo],
        compatibleOwnerUids: ['compatible-1', 'compatible-13'],
      }
    );

    expect(result.map((item) => item.key)).toEqual([
      'video:compatible-13:remote-video',
    ]);
  });
});

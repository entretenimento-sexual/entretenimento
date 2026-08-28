import { describe, expect, it } from 'vitest';

import { IPublicPhotoProjection } from 'src/app/core/interfaces/media/i-public-photo-item';
import { IPublicVideoProjection } from 'src/app/core/interfaces/media/i-public-video-item';
import { selectPublicProfileMediaPreviewCandidates } from './media-public-preview-query.service';

function photo(
  id: string,
  orderIndex: number,
  options: { isCover?: boolean; publishedAt?: number } = {}
): IPublicPhotoProjection {
  return {
    id,
    ownerUid: 'owner-1',
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    createdAt: options.publishedAt ?? 1_700_000_000_000,
    publishedAt: options.publishedAt ?? 1_700_000_000_000,
    updatedAt: options.publishedAt ?? 1_700_000_000_000,
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    isCover: options.isCover === true,
    orderIndex,
  };
}

function video(
  id: string,
  orderIndex: number,
  publishedAt = 1_700_000_000_000
): IPublicVideoProjection {
  return {
    id,
    ownerUid: 'owner-1',
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'NONE',
    title: 'Vídeo público',
    description: null,
    alt: 'Vídeo público',
    mimeType: 'video/mp4',
    sizeBytes: 1_024,
    durationMs: 10_000,
    createdAt: publishedAt,
    publishedAt,
    updatedAt: publishedAt,
    lastViewedAt: null,
    visibility: 'PUBLIC',
    orderIndex,
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
  };
}

describe('selectPublicProfileMediaPreviewCandidates', () => {
  it('limita a seleção final antes da hidratação de URLs', () => {
    const photos = Array.from({ length: 5 }, (_, index) =>
      photo(`photo-${index + 1}`, index)
    );
    const videos = Array.from({ length: 5 }, (_, index) =>
      video(`video-${index + 1}`, index)
    );

    const result = selectPublicProfileMediaPreviewCandidates(
      photos,
      videos,
      5
    );

    expect(result).toHaveLength(5);
  });

  it('preserva prioridade da capa sem precisar carregar todas as fotos', () => {
    const result = selectPublicProfileMediaPreviewCandidates(
      [photo('photo-normal', 0), photo('photo-cover', 99, { isCover: true })],
      [video('video-1', 0)],
      2
    );

    expect(result.map((item) => item.id)).toEqual([
      'photo-cover',
      'photo-normal',
    ]);
  });

  it('intercala tipos pela ordenação canônica e remove identidades duplicadas', () => {
    const result = selectPublicProfileMediaPreviewCandidates(
      [
        photo('photo-1', 1, { publishedAt: 100 }),
        photo('photo-1', 1, { publishedAt: 100 }),
      ],
      [video('video-1', 0, 90)],
      5
    );

    expect(result.map((item) => item.id)).toEqual(['video-1', 'photo-1']);
  });
});

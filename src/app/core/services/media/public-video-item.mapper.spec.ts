import { describe, expect, it } from 'vitest';

import type { IPublicVideoAccess } from 'src/app/core/interfaces/media/i-public-video-item';
import {
  buildPublicVideoKey,
  hydratePublicVideoItem,
  isPublicVideoAccessUsable,
  mapPublicVideoProjection,
} from './public-video-item.mapper';

const NOW = 1_800_000_000_000;

function createValidDocument(): Record<string, unknown> {
  return {
    id: 'video-1',
    ownerUid: 'owner-1',
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'SIGNED_URL',
    title: '  Uma noite especial  ',
    description: 'Descrição pública',
    alt: 'Vídeo do perfil',
    mimeType: 'video/mp4',
    sizeBytes: 1_024,
    durationMs: 8_500,
    createdAt: 1_700_000_000_000,
    publishedAt: 1_700_000_100_000,
    updatedAt: 1_700_000_200_000,
    lastViewedAt: 1_700_000_300_000,
    visibility: 'PUBLIC',
    orderIndex: 3,
    moderationStatus: 'APPROVED',
    moderationReason: null,
    reactionsEnabled: true,
    commentsEnabled: false,
    ratingsEnabled: true,
    viewsCount: 120,
    uniqueViewersCount: 75,
    reactionsCount: 18,
    commentsCount: 7,
    ratingsCount: 4,
    ratingAverage: 4.25,
    reportsCount: 2,
    openReportsCount: 1,
    confirmedReportsCount: 0,
    viewScore: 88,
    engagementScore: 64,
    score: 71,
    scoreBreakdown: {
      rankingScore: 71,
      qualityScore: 55,
      engagementScore: 64,
      safetyScore: 92,
    },
    ownerNickname: 'Alex',
    ownerPhotoURL: 'https://example.test/avatar.jpg',
    ownerEstado: 'RJ',
  };
}

function createAccess(): IPublicVideoAccess {
  return {
    ownerUid: 'owner-1',
    videoId: 'video-1',
    url: 'http://127.0.0.1:9199/hd.mp4?token=default',
    posterUrl: 'https://example.test/poster.webp?token=test',
    variants: [
      {
        quality: 'SD',
        url: 'http://127.0.0.1:9199/sd.mp4?token=sd',
        mimeType: 'video/mp4',
        sizeBytes: 512,
      },
      {
        quality: 'HD',
        url: 'http://127.0.0.1:9199/hd.mp4?token=hd',
        mimeType: 'video/mp4',
        sizeBytes: 2_048,
      },
    ],
    defaultQuality: 'HD',
    expiresAt: NOW + 5 * 60_000,
  };
}

describe('public-video-item.mapper', () => {
  it('normaliza a projeção pública completa sem expor URL ou path', () => {
    const projection = mapPublicVideoProjection({
      documentId: 'video-1',
      expectedOwnerUid: 'owner-1',
      data: {
        ...createValidDocument(),
        url: 'https://example.test/permanent.mp4',
        path: 'users/owner-1/videos/private.mp4',
      },
    });

    expect(projection).not.toBeNull();
    expect(projection).toMatchObject({
      id: 'video-1',
      ownerUid: 'owner-1',
      title: 'Uma noite especial',
      visibility: 'PUBLIC',
      moderationStatus: 'APPROVED',
      commentsEnabled: false,
      viewsCount: 120,
      reactionsCount: 18,
      ratingAverage: 4.25,
      score: 71,
      owner: {
        nickname: 'Alex',
        photoURL: 'https://example.test/avatar.jpg',
        estado: 'RJ',
      },
    });
    expect(projection).not.toHaveProperty('url');
    expect(projection).not.toHaveProperty('path');
  });

  it('descarta vídeo não aprovado, não público ou com dono inconsistente', () => {
    expect(mapPublicVideoProjection({
      documentId: 'video-1',
      expectedOwnerUid: 'owner-1',
      data: { ...createValidDocument(), moderationStatus: 'PENDING_REVIEW' },
    })).toBeNull();

    expect(mapPublicVideoProjection({
      documentId: 'video-1',
      expectedOwnerUid: 'owner-1',
      data: { ...createValidDocument(), visibility: 'FRIENDS' },
    })).toBeNull();

    expect(mapPublicVideoProjection({
      documentId: 'video-1',
      expectedOwnerUid: 'owner-2',
      data: createValidDocument(),
    })).toBeNull();
  });

  it('normaliza métricas legadas e limita valores inválidos', () => {
    const projection = mapPublicVideoProjection({
      documentId: 'video-1',
      data: {
        ...createValidDocument(),
        reactionsCount: undefined,
        likesCount: 9.9,
        commentsCount: -5,
        ratingsCount: Number.NaN,
        ratingAverage: 9,
        viewScore: 200,
        score: -10,
        scoreBreakdown: {
          safetyScore: 400,
        },
      },
    });

    expect(projection).toMatchObject({
      reactionsCount: 9,
      commentsCount: 0,
      ratingsCount: 0,
      ratingAverage: 5,
      viewScore: 100,
      score: 0,
      scoreBreakdown: {
        rankingScore: 0,
        qualityScore: 0,
        engagementScore: 64,
        safetyScore: 100,
      },
    });
  });

  it('hidrata somente URL temporária correspondente e ainda válida', () => {
    const projection = mapPublicVideoProjection({
      documentId: 'video-1',
      data: createValidDocument(),
    });
    const access = createAccess();

    expect(projection).not.toBeNull();
    expect(isPublicVideoAccessUsable(projection!, access, NOW)).toBe(true);
    expect(hydratePublicVideoItem(projection!, access, NOW)).toMatchObject({
      id: 'video-1',
      url: access.variants?.[1].url,
      posterUrl: access.posterUrl,
      accessExpiresAt: access.expiresAt,
      playbackQuality: 'HD',
      sizeBytes: 2_048,
    });

    expect(hydratePublicVideoItem(projection!, {
      ...access,
      ownerUid: 'other-owner',
    }, NOW)).toBeNull();

    expect(hydratePublicVideoItem(projection!, {
      ...access,
      expiresAt: NOW + 5_000,
    }, NOW)).toBeNull();
  });

  it('seleciona SD para economia de dados', () => {
    const projection = mapPublicVideoProjection({
      documentId: 'video-1',
      data: createValidDocument(),
    });
    const access = createAccess();
    const item = hydratePublicVideoItem(
      projection!,
      access,
      NOW,
      {
        documentVisible: true,
        online: true,
        saveData: true,
        effectiveType: '4g',
        downlinkMbps: 10,
      }
    );

    expect(item).toMatchObject({
      url: access.variants?.[0].url,
      playbackQuality: 'SD',
      sizeBytes: 512,
    });
  });

  it('mantém compatibilidade com resposta de URL única', () => {
    const projection = mapPublicVideoProjection({
      documentId: 'video-1',
      data: createValidDocument(),
    });
    const legacyAccess: IPublicVideoAccess = {
      ownerUid: 'owner-1',
      videoId: 'video-1',
      url: 'http://127.0.0.1:9199/video.mp4?token=legacy',
      posterUrl: null,
      expiresAt: NOW + 5 * 60_000,
    };

    expect(hydratePublicVideoItem(projection!, legacyAccess, NOW)).toMatchObject({
      url: legacyAccess.url,
      playbackQuality: 'HD',
      playbackVariants: [],
    });
  });

  it('rejeita lote de variantes informado, mas totalmente inválido', () => {
    const projection = mapPublicVideoProjection({
      documentId: 'video-1',
      data: createValidDocument(),
    });
    const access: IPublicVideoAccess = {
      ...createAccess(),
      variants: [
        {
          quality: 'HD',
          url: 'javascript:alert(1)',
          mimeType: 'video/mp4',
          sizeBytes: 2_048,
        },
      ],
    };

    expect(isPublicVideoAccessUsable(projection!, access, NOW)).toBe(false);
  });

  it('gera chave estável para cache e deduplicação', () => {
    expect(buildPublicVideoKey('owner-1', 'video-1')).toBe('owner-1:video-1');
  });
});

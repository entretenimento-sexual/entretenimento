import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { PublicMediaReadBoundaryService } from './public-media-read-boundary.service';
import { PublicPhotoAccessService } from './public-photo-access.service';
import { PublicVideoAccessService } from './public-video-access.service';
import { MediaApplicationErrorService } from './media-application-error.service';
import { MediaPublicPreviewQueryService } from './media-public-preview-query.service';

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

  it('não seleciona fotos ou vídeos de outro proprietário ou não públicos', () => {
    const approvedPhoto = photo('photo-publica', 3);
    const approvedVideo = video('video-publico', 2);
    const result = selectPublicProfileMediaPreviewCandidates(
      [
        { ...approvedPhoto, id: 'photo-outro-perfil', ownerUid: 'owner-2' },
        { ...approvedPhoto, id: 'photo-restrita', visibility: 'FRIENDS' },
        { ...approvedPhoto, id: 'photo-nao-aprovada', moderationStatus: 'HIDDEN' },
        approvedPhoto,
      ],
      [
        { ...approvedVideo, id: 'video-outro-perfil', ownerUid: 'owner-2' },
        { ...approvedVideo, id: 'video-restrito',
          visibility: 'PRIVATE' } as unknown as IPublicVideoProjection,
        { ...approvedVideo, id: 'video-nao-aprovado',
          moderationStatus: 'FLAGGED' } as unknown as IPublicVideoProjection,
        approvedVideo,
      ],
      5,
      'owner-1'
    );

    expect(result.map((item) => item.id)).toEqual([
      'video-publico',
      'photo-publica',
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

describe('MediaPublicPreviewQueryService / métricas opcionais', () => {
  function setup(denyBackend = false) {
    const denied = Object.assign(new Error('Missing or insufficient permissions'), {
      code: 'permission-denied',
    });
    const reportSilently = vi.fn();
    const deferObservable$ = vi.fn((): Observable<unknown> => throwError(() => denied));
    const read$ = vi.fn((request: { mediaType: string }) =>
      denyBackend && request.mediaType === 'PHOTO'
        ? throwError(() => denied)
        : of({
            items: request.mediaType === 'PHOTO'
              ? [photo('photo-publica', 0)]
              : [],
            nextCursor: null,
            hasMore: false,
            fetchedAt: Date.now(),
            scanned: 1,
          })
    );
    const hydratePublicPhotoUrls$ = vi.fn((projections: unknown[]) =>
      of(projections.map((projection) => ({
        ...(projection as Record<string, unknown>),
        url: 'https://example.test/photo-publica.jpg',
      })))
    );
    TestBed.configureTestingModule({
      providers: [
        MediaPublicPreviewQueryService,
        { provide: Firestore, useValue: {} },
        {
          provide: FirestoreContextService,
          useValue: {
            deferObservable$,
          },
        },
        { provide: PublicMediaReadBoundaryService, useValue: { read$ } },
        {
          provide: PublicPhotoAccessService,
          useValue: { hydratePublicPhotoUrls$ },
        },
        {
          provide: PublicVideoAccessService,
          useValue: { hydratePublicVideoPreviews$: vi.fn(() => of([])) },
        },
        {
          provide: MediaApplicationErrorService,
          useValue: { reportSilently },
        },
      ],
    });
    return {
      query: TestBed.inject(MediaPublicPreviewQueryService),
      read$,
      deferObservable$,
      reportSilently,
      denied,
    };
  }

  it('reutiliza contagens do discovery sem consultar Firestore diretamente', async () => {
    const { query, read$, reportSilently, deferObservable$ } = setup();
    const result = await firstValueFrom(
      query.getProfilePublicMediaPreview$('owner-1', 5, {
        propagateErrors: true,
        profileMetrics: {
          publicPhotosCount: 42,
          publicVideosCount: 7,
        },
      })
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('photo-publica');
    expect(result.photosCount).toBe(42);
    expect(result.videosCount).toBe(7);
    expect(result.totalCount).toBe(49);
    expect(read$).toHaveBeenCalledTimes(2);
    expect(deferObservable$).not.toHaveBeenCalled();
    expect(reportSilently).not.toHaveBeenCalled();
  });

  it('sem métricas fornecidas mantém contagem mínima sem leitura privada', async () => {
    const { query, deferObservable$ } = setup();
    const result = await firstValueFrom(
      query.getProfilePublicMediaPreview$('owner-1', 5, {
        propagateErrors: true,
      })
    );

    expect(result.photosCount).toBe(1);
    expect(result.videosCount).toBe(0);
    expect(deferObservable$).not.toHaveBeenCalled();
  });

  it('considera a capa pública aprovada quando está fora da primeira janela', async () => {
    const { query, deferObservable$ } = setup();
    deferObservable$.mockReturnValue(
      of(photo('cover-outside-window', 99, { isCover: true }))
    );

    const result = await firstValueFrom(
      query.getProfilePublicMediaPreview$('owner-1', 2, {
        propagateErrors: true,
        profileMetrics: { coverPhotoId: 'cover-outside-window' },
      })
    );

    expect(deferObservable$).toHaveBeenCalledTimes(1);
    expect(result.items.map((item) => item.id)).toEqual([
      'cover-outside-window',
      'photo-publica',
    ]);
  });

  it('nunca usa uma capa fora da audiência PUBLIC e da moderação APPROVED', async () => {
    const { query, deferObservable$ } = setup();
    deferObservable$.mockReturnValue(
      of({
        ...photo('cover-restrita', 99, { isCover: true }),
        visibility: 'FRIENDS',
      })
    );

    const result = await firstValueFrom(
      query.getProfilePublicMediaPreview$('owner-1', 2, {
        propagateErrors: true,
        profileMetrics: { coverPhotoId: 'cover-restrita' },
      })
    );

    expect(result.items.map((item) => item.id)).toEqual(['photo-publica']);
  });

  it('não ignora a rejeição da callable que autoriza a própria mídia', async () => {
    const { query, denied, reportSilently } = setup(true);

    await expect(firstValueFrom(
      query.getProfilePublicMediaPreview$('owner-1', 5, {
        propagateErrors: true,
      })
    )).rejects.toBe(denied);

    expect(reportSilently).toHaveBeenCalledWith(
      denied,
      'getProfilePublicMediaPreview$',
      expect.any(String),
      expect.objectContaining({ ownerUid: 'owner-1' })
    );
  });
});

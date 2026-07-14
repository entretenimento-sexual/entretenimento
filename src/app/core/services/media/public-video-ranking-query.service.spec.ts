import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type {
  IPublicVideoRankingCursor,
} from 'src/app/core/interfaces/media/i-public-video-ranking';
import {
  hydratePublicVideoItem,
  mapPublicVideoProjection,
} from './public-video-item.mapper';
import { PublicVideoRankingQueryService } from './public-video-ranking-query.service';

const PUBLISHED_AT = 1_700_000_000_000;
const ACCESS_NOW = 1_800_000_000_000;

function createPublicVideoData(): Record<string, unknown> {
  return {
    id: 'video-1',
    ownerUid: 'owner-1',
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'NONE',
    title: 'Vídeo público',
    mimeType: 'video/mp4',
    sizeBytes: 2_048,
    durationMs: 10_000,
    createdAt: PUBLISHED_AT,
    publishedAt: PUBLISHED_AT,
    updatedAt: PUBLISHED_AT,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    reactionsEnabled: true,
    commentsEnabled: true,
    ratingsEnabled: true,
    score: 70,
    uniqueViewersCount: 25,
    viewsCount: 40,
  };
}

function createService(options?: {
  gatewayError?: unknown;
  rawDocuments?: Array<{
    id: string;
    path: string;
    data: Record<string, unknown>;
  }>;
}) {
  const projection = mapPublicVideoProjection({
    documentId: 'video-1',
    data: createPublicVideoData(),
  })!;
  const item = hydratePublicVideoItem(projection, {
    ownerUid: 'owner-1',
    videoId: 'video-1',
    url: 'https://example.test/video.mp4?token=temporary',
    posterUrl: null,
    expiresAt: ACCESS_NOW + 300_000,
  }, ACCESS_NOW)!;
  const nextCursor: IPublicVideoRankingCursor = {
    mode: 'top',
    score: 70,
    uniqueViewersCount: 25,
    viewsCount: 40,
    publishedAt: PUBLISHED_AT,
    documentPath: 'public_profiles/owner-1/public_videos/video-1',
  };
  const gateway = {
    loadPage$: vi.fn(() => options?.gatewayError
      ? throwError(() => options.gatewayError)
      : of({
        documents: options?.rawDocuments ?? [{
          id: 'video-1',
          path: nextCursor.documentPath,
          data: createPublicVideoData(),
        }],
        nextCursor,
        hasMore: true,
      })),
  };
  const publicVideoAccess = {
    hydratePublicVideoUrls$: vi.fn(() => of([item])),
  };
  const errorNotifier = {
    showError: vi.fn(),
  };
  const errorHandler = {
    handleError: vi.fn(),
  };
  const service = new PublicVideoRankingQueryService(
    gateway as never,
    publicVideoAccess as never,
    errorNotifier as never,
    errorHandler as never
  );

  return {
    service,
    gateway,
    publicVideoAccess,
    errorNotifier,
    errorHandler,
    item,
    nextCursor,
  };
}

describe('PublicVideoRankingQueryService', () => {
  it('carrega página top, normaliza o limite e preserva o cursor', async () => {
    const context = createService();

    const page = await firstValueFrom(context.service.loadPage$({
      mode: 'top',
      pageSize: 99,
    }));

    expect(context.gateway.loadPage$).toHaveBeenCalledWith({
      mode: 'top',
      pageSize: 16,
      cursor: null,
    });
    expect(context.publicVideoAccess.hydratePublicVideoUrls$)
      .toHaveBeenCalledTimes(1);
    expect(page).toMatchObject({
      mode: 'top',
      source: 'top',
      items: [context.item],
      nextCursor: context.nextCursor,
      hasMore: true,
    });
  });

  it('ignora cursor de outro modo e descarta projeção inválida', async () => {
    const context = createService({
      rawDocuments: [{
        id: 'video-hidden',
        path: 'public_profiles/owner-1/public_videos/video-hidden',
        data: {
          ...createPublicVideoData(),
          id: 'video-hidden',
          moderationStatus: 'PENDING_REVIEW',
        },
      }],
    });

    await firstValueFrom(context.service.loadPage$({
      mode: 'latest',
      cursor: context.nextCursor,
    }));

    expect(context.gateway.loadPage$).toHaveBeenCalledWith({
      mode: 'latest',
      pageSize: 12,
      cursor: null,
    });
    expect(context.publicVideoAccess.hydratePublicVideoUrls$)
      .toHaveBeenCalledWith([]);
  });

  it('centraliza o erro e devolve página vazia estável', async () => {
    const failure = new Error('firestore unavailable');
    const context = createService({ gatewayError: failure });

    const page = await firstValueFrom(context.service.loadPage$({
      mode: 'top',
      notifyOnError: true,
    }));

    expect(context.errorNotifier.showError).toHaveBeenCalledWith(
      'Não foi possível carregar os vídeos públicos.'
    );
    expect(context.errorHandler.handleError).toHaveBeenCalledTimes(1);
    expect(page).toMatchObject({
      mode: 'top',
      source: 'top',
      items: [],
      nextCursor: null,
      hasMore: false,
    });
  });
});

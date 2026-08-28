import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { IPublicPhotoRankingCursor } from 'src/app/core/interfaces/media/i-public-photo-ranking';
import type {
  IPublicPhotoItem,
  IPublicPhotoProjection,
} from 'src/app/core/interfaces/media/i-public-photo-item';
import { PublicPhotoRankingQueryService } from './public-photo-ranking-query.service';

const PUBLISHED_AT = 1_700_000_000_000;

function createPublicPhotoData(): Record<string, unknown> {
  return {
    ownerUid: 'owner-1',
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    alt: 'Foto pública',
    createdAt: PUBLISHED_AT,
    publishedAt: PUBLISHED_AT,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    reactionsEnabled: true,
    commentsEnabled: true,
    commentsPolicy: 'EVERYONE',
    score: 70,
  };
}

function createService(options?: { gatewayError?: unknown }) {
  const nextCursor: IPublicPhotoRankingCursor = {
    mode: 'top',
    score: 70,
    publishedAt: PUBLISHED_AT,
    documentPath: 'public_profiles/owner-1/public_photos/photo-1',
  };
  const item: IPublicPhotoItem = {
    ...(createPublicPhotoData() as unknown as IPublicPhotoProjection),
    id: 'photo-1',
    url: 'https://example.test/photo.jpg?token=temporary',
  };
  const gateway = {
    loadPage$: vi.fn(() => options?.gatewayError
      ? throwError(() => options.gatewayError)
      : of({
        documents: [{
          id: 'photo-1',
          path: nextCursor.documentPath,
          data: createPublicPhotoData(),
        }],
        nextCursor,
        hasMore: true,
      })),
  };
  const publicPhotoAccess = {
    hydratePublicPhotoUrls$: vi.fn((projections: readonly IPublicPhotoProjection[]) =>
      of(projections.length ? [item] : [])
    ),
  };
  const errorNotifier = { showError: vi.fn() };
  const errorHandler = { handleError: vi.fn() };
  const service = new PublicPhotoRankingQueryService(
    gateway as never,
    publicPhotoAccess as never,
    errorNotifier as never,
    errorHandler as never
  );

  return {
    service,
    gateway,
    publicPhotoAccess,
    errorNotifier,
    errorHandler,
    item,
    nextCursor,
  };
}

describe('PublicPhotoRankingQueryService', () => {
  it('carrega página top, limita pageSize e preserva cursor estável', async () => {
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
    expect(context.publicPhotoAccess.hydratePublicPhotoUrls$)
      .toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'photo-1',
          ownerUid: 'owner-1',
          moderationStatus: 'APPROVED',
        }),
      ]);
    expect(page).toMatchObject({
      mode: 'top',
      source: 'top',
      items: [context.item],
      nextCursor: context.nextCursor,
      hasMore: true,
    });
  });

  it('ignora cursor de outro modo', async () => {
    const context = createService();

    await firstValueFrom(context.service.loadPage$({
      mode: 'latest',
      cursor: context.nextCursor,
    }));

    expect(context.gateway.loadPage$).toHaveBeenCalledWith({
      mode: 'latest',
      pageSize: 12,
      cursor: null,
    });
  });

  it('centraliza erro e devolve página vazia estável por padrão', async () => {
    const failure = new Error('firestore unavailable');
    const context = createService({ gatewayError: failure });

    const page = await firstValueFrom(context.service.loadPage$({
      mode: 'top',
      notifyOnError: true,
    }));

    expect(context.errorNotifier.showError).toHaveBeenCalledWith(
      'Não foi possível carregar as fotos públicas.'
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

  it('propaga erro após registrar diagnóstico quando solicitado', async () => {
    const failure = new Error('firestore unavailable');
    const context = createService({ gatewayError: failure });

    await expect(firstValueFrom(context.service.loadPage$({
      mode: 'latest',
      propagateErrors: true,
    }))).rejects.toBe(failure);

    expect(context.errorNotifier.showError).not.toHaveBeenCalled();
    expect(context.errorHandler.handleError).toHaveBeenCalledTimes(1);
  });
});

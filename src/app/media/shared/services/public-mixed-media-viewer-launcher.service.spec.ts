import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicProfileMediaItem } from 'src/app/core/interfaces/media/i-public-profile-media-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicMixedMediaContinuationService } from 'src/app/core/services/media/public-mixed-media-continuation.service';
import { PublicPhotoViewerLauncherService } from 'src/app/media/photos/photo-viewer/public-photo-viewer-launcher.service';
import { PublicVideoViewerLauncherService } from 'src/app/media/videos/public-video-viewer/public-video-viewer-launcher.service';
import { PublicMixedMediaViewerLauncherService } from './public-mixed-media-viewer-launcher.service';

function photo(ownerUid: string, id: string): IPublicPhotoItem {
  return {
    id,
    ownerUid,
    mediaType: 'PHOTO',
    url: `https://example.test/${ownerUid}/${id}.jpg`,
    createdAt: 100,
    publishedAt: 100,
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    orderIndex: 0,
  } as IPublicPhotoItem;
}

function video(ownerUid: string, id: string): IPublicVideoItem {
  return {
    id,
    ownerUid,
    mediaType: 'VIDEO',
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    title: id,
    url: null,
    posterUrl: null,
  } as IPublicVideoItem;
}

describe('PublicMixedMediaViewerLauncherService', () => {
  const photoViewer = {
    openWithResult$: vi.fn(),
  };
  const videoViewer = {
    openWithResult$: vi.fn(),
  };
  const mixedContinuation = {
    loadContinuation$: vi.fn(),
  };
  const errorNotification = {
    showInfo: vi.fn(),
    showWarning: vi.fn(),
  };
  const globalError = {
    handleError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mixedContinuation.loadContinuation$.mockReturnValue(of({
      items: [],
      exhausted: true,
      failed: false,
      degraded: false,
    }));

    TestBed.configureTestingModule({
      providers: [
        PublicMixedMediaViewerLauncherService,
        { provide: PublicPhotoViewerLauncherService, useValue: photoViewer },
        { provide: PublicVideoViewerLauncherService, useValue: videoViewer },
        { provide: PublicMixedMediaContinuationService, useValue: mixedContinuation },
        { provide: ErrorNotificationService, useValue: errorNotification },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });
  });

  it('preserva a ordem mista atravessando trechos contíguos de foto e vídeo', async () => {
    const service = TestBed.inject(PublicMixedMediaViewerLauncherService);
    const photoA = photo('owner-a', 'photo-a');
    const photoB = photo('owner-b', 'photo-b');
    const videoC = video('owner-c', 'video-c');
    const videoD = video('owner-d', 'video-d');
    const photoE = photo('owner-e', 'photo-e');
    const context = {
      connectionOwnerUids: ['owner-b'],
      compatibleOwnerUids: ['owner-d'],
    };

    photoViewer.openWithResult$
      .mockReturnValueOnce(of({ kind: 'mixed-handoff', direction: 'next' }))
      .mockReturnValueOnce(of(undefined));
    videoViewer.openWithResult$
      .mockReturnValueOnce(of({ kind: 'mixed-handoff', direction: 'next' }));

    await firstValueFrom(service.open$({
      items: [photoA, photoB, videoC, videoD, photoE],
      selected: photoB,
      source: 'latest',
      continuationContext: context,
    }));

    expect(photoViewer.openWithResult$).toHaveBeenNthCalledWith(1, {
      items: [photoA, photoB],
      selected: photoB,
      source: 'latest',
      continuationContext: context,
      mixedNavigation: {
        hasPrevious: false,
        hasNext: true,
      },
    });
    expect(videoViewer.openWithResult$).toHaveBeenCalledWith({
      items: [videoC, videoD],
      startIndex: 0,
      source: 'latest',
      continuationContext: context,
      mixedNavigation: {
        hasPrevious: true,
        hasNext: true,
      },
    });
    expect(photoViewer.openWithResult$).toHaveBeenNthCalledWith(2, {
      items: [photoE],
      selected: photoE,
      source: 'latest',
      continuationContext: context,
      mixedNavigation: {
        hasPrevious: true,
        hasNext: true,
      },
    });
    expect(mixedContinuation.loadContinuation$).not.toHaveBeenCalled();
  });

  it('retorna ao último item do trecho anterior ao receber handoff previous', async () => {
    const service = TestBed.inject(PublicMixedMediaViewerLauncherService);
    const photoA = photo('owner-a', 'photo-a');
    const photoB = photo('owner-b', 'photo-b');
    const videoC = video('owner-c', 'video-c');
    const videoD = video('owner-d', 'video-d');

    videoViewer.openWithResult$.mockReturnValueOnce(of({
      kind: 'mixed-handoff',
      direction: 'previous',
    }));
    photoViewer.openWithResult$.mockReturnValueOnce(of(undefined));

    await firstValueFrom(service.open$({
      items: [photoA, photoB, videoC, videoD],
      selected: videoD,
      source: 'profile',
    }));

    expect(videoViewer.openWithResult$).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [videoC, videoD],
        startIndex: 1,
      })
    );
    expect(photoViewer.openWithResult$).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [photoA, photoB],
        selected: photoB,
      })
    );
  });

  it('remove duplicatas e mídia pública inválida antes de formar a sessão', async () => {
    const service = TestBed.inject(PublicMixedMediaViewerLauncherService);
    const selected = photo('owner-a', 'photo-a');
    const duplicate = { ...selected } as IPublicPhotoItem;
    const flagged = {
      ...video('owner-b', 'video-b'),
      moderationStatus: 'FLAGGED',
    } as unknown as IPublicProfileMediaItem;

    photoViewer.openWithResult$.mockReturnValueOnce(of(undefined));

    await firstValueFrom(service.open$({
      items: [selected, duplicate, flagged],
      selected,
      source: 'discover',
    }));

    expect(photoViewer.openWithResult$).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [selected],
        mixedNavigation: {
          hasPrevious: false,
          hasNext: true,
        },
      })
    );
    expect(videoViewer.openWithResult$).not.toHaveBeenCalled();
  });

  it('anexa continuação mista e abre o próximo trecho sem perder contexto', async () => {
    const service = TestBed.inject(PublicMixedMediaViewerLauncherService);
    const first = photo('owner-a', 'photo-a');
    const nextVideo = video('owner-b', 'video-b');
    const nextPhoto = photo('owner-c', 'photo-c');
    const context = {
      connectionOwnerUids: ['owner-b'],
      compatibleOwnerUids: ['owner-c'],
    };

    photoViewer.openWithResult$
      .mockReturnValueOnce(of({ kind: 'mixed-handoff', direction: 'next' }))
      .mockReturnValueOnce(of(undefined));
    videoViewer.openWithResult$.mockReturnValueOnce(of({
      kind: 'mixed-handoff',
      direction: 'next',
    }));
    mixedContinuation.loadContinuation$.mockReturnValueOnce(of({
      items: [nextVideo, nextPhoto],
      exhausted: false,
      failed: false,
      degraded: false,
    }));

    await firstValueFrom(service.open$({
      items: [first],
      selected: first,
      source: 'latest',
      continuationContext: context,
    }));

    expect(mixedContinuation.loadContinuation$).toHaveBeenCalledWith({
      existingItems: [first],
      source: 'latest',
      limit: 8,
      continuationContext: context,
    });
    expect(videoViewer.openWithResult$).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [nextVideo],
        startIndex: 0,
        continuationContext: context,
      })
    );
    expect(photoViewer.openWithResult$).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        items: [nextPhoto],
        selected: nextPhoto,
        continuationContext: context,
      })
    );
  });

  it('informa fim real quando a continuação está esgotada', async () => {
    const service = TestBed.inject(PublicMixedMediaViewerLauncherService);
    const selected = photo('owner-a', 'photo-a');

    photoViewer.openWithResult$.mockReturnValueOnce(of({
      kind: 'mixed-handoff',
      direction: 'next',
    }));

    await firstValueFrom(service.open$({
      items: [selected],
      selected,
      source: 'latest',
    }));

    expect(errorNotification.showInfo).toHaveBeenCalledWith(
      'Você chegou ao fim das mídias públicas disponíveis agora.'
    );
    expect(errorNotification.showWarning).not.toHaveBeenCalled();
  });

  it('avisa o usuário e registra diagnóstico quando a continuação falha', async () => {
    const service = TestBed.inject(PublicMixedMediaViewerLauncherService);
    const selected = photo('owner-a', 'photo-a');

    photoViewer.openWithResult$.mockReturnValueOnce(of({
      kind: 'mixed-handoff',
      direction: 'next',
    }));
    mixedContinuation.loadContinuation$.mockReturnValueOnce(of({
      items: [],
      exhausted: false,
      failed: true,
      degraded: true,
    }));

    await firstValueFrom(service.open$({
      items: [selected],
      selected,
      source: 'latest',
    }));

    expect(errorNotification.showWarning).toHaveBeenCalledWith(
      'Não foi possível carregar mais mídias agora. Tente novamente mais tarde.'
    );
    expect(globalError.handleError).toHaveBeenCalledTimes(1);
    expect(errorNotification.showInfo).not.toHaveBeenCalled();
  });
});

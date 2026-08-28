import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { PublicPhotoContinuationService } from './public-photo-continuation.service';
import { PublicMediaRecentViewService } from './public-media-recent-view.service';
import { PublicMixedMediaContinuationService } from './public-mixed-media-continuation.service';
import { PublicVideoContinuationService } from './public-video-continuation.service';

function photo(
  ownerUid: string,
  id: string,
  publishedAt: number
): IPublicPhotoItem {
  return {
    id,
    ownerUid,
    mediaType: 'PHOTO',
    url: `https://example.test/${ownerUid}/${id}.jpg`,
    createdAt: publishedAt,
    publishedAt,
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    orderIndex: 0,
  } as IPublicPhotoItem;
}

function video(
  ownerUid: string,
  id: string,
  publishedAt: number
): IPublicVideoItem {
  return {
    id,
    ownerUid,
    mediaType: 'VIDEO',
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    publishedAt,
    createdAt: publishedAt,
    title: id,
    url: null,
    posterUrl: null,
  } as IPublicVideoItem;
}

describe('PublicMixedMediaContinuationService', () => {
  const photoContinuation = {
    loadContinuation$: vi.fn(),
  };
  const videoContinuation = {
    loadContinuation$: vi.fn(),
  };
  const recentViews = {
    resolveRecentViewedKeys$: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    photoContinuation.loadContinuation$.mockReturnValue(of({
      items: [],
      exhausted: true,
      failed: false,
      degraded: false,
    }));
    videoContinuation.loadContinuation$.mockReturnValue(of({
      items: [],
      exhausted: true,
      failed: false,
      degraded: false,
    }));
    recentViews.resolveRecentViewedKeys$.mockReturnValue(of([]));

    TestBed.configureTestingModule({
      providers: [
        PublicMixedMediaContinuationService,
        { provide: AuthSessionService, useValue: { uid$: of('viewer-uid') } },
        { provide: PublicPhotoContinuationService, useValue: photoContinuation },
        { provide: PublicVideoContinuationService, useValue: videoContinuation },
        { provide: PublicMediaRecentViewService, useValue: recentViews },
      ],
    });
  });

  it('encaminha exclusões por tipo e o UID do viewer para as fontes canônicas', async () => {
    const service = TestBed.inject(PublicMixedMediaContinuationService);
    const existingPhoto = photo('owner-a', 'photo-a', 100);
    const existingVideo = video('owner-b', 'video-b', 90);
    const context = {
      connectionOwnerUids: ['friend-owner'],
      compatibleOwnerUids: ['compatible-owner'],
    };

    await firstValueFrom(service.loadContinuation$({
      existingItems: [existingPhoto, existingVideo],
      source: 'latest',
      limit: 8,
      continuationContext: context,
    }));

    expect(photoContinuation.loadContinuation$).toHaveBeenCalledWith({
      existingItems: [existingPhoto],
      source: 'latest',
      excludeOwnerUid: 'viewer-uid',
      limit: 12,
      continuationContext: context,
    });
    expect(videoContinuation.loadContinuation$).toHaveBeenCalledWith({
      existingItems: [existingVideo],
      source: 'latest',
      excludeOwnerUid: 'viewer-uid',
      limit: 12,
      continuationContext: context,
    });
  });

  it('aplica novidade, prioridade social e diversidade somente após reunir foto e vídeo', async () => {
    const service = TestBed.inject(PublicMixedMediaContinuationService);
    const friendPhoto = photo('friend-owner', 'friend-photo', 1_000);
    const globalPhoto1 = photo('global-a', 'global-photo-1', 900);
    const globalPhoto2 = photo('global-b', 'global-photo-2', 800);
    const compatibleVideo = video('compatible-owner', 'compatible-video', 950);
    const globalVideo1 = video('global-c', 'global-video-1', 750);
    const globalVideo2 = video('global-d', 'global-video-2', 650);

    photoContinuation.loadContinuation$.mockReturnValueOnce(of({
      items: [friendPhoto, globalPhoto1, globalPhoto2],
      exhausted: false,
      failed: false,
      degraded: false,
    }));
    videoContinuation.loadContinuation$.mockReturnValueOnce(of({
      items: [compatibleVideo, globalVideo1, globalVideo2],
      exhausted: false,
      failed: false,
      degraded: false,
    }));
    recentViews.resolveRecentViewedKeys$.mockReturnValueOnce(of([
      JSON.stringify(['PHOTO', 'global-a', 'global-photo-1']),
    ]));

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [],
      source: 'latest',
      limit: 6,
      continuationContext: {
        connectionOwnerUids: ['friend-owner'],
        compatibleOwnerUids: ['compatible-owner'],
      },
    }));

    expect(result.failed).toBe(false);
    expect(result.exhausted).toBe(false);
    expect(result.items.map((item) => item.id)).toEqual([
      'friend-photo',
      'global-photo-2',
      'global-video-1',
      'compatible-video',
      'global-video-2',
      'global-photo-1',
    ]);
  });

  it('continua com a fonte saudável e marca degradação quando a outra falha', async () => {
    const service = TestBed.inject(PublicMixedMediaContinuationService);
    const healthyVideo = video('global-video-owner', 'healthy-video', 500);

    photoContinuation.loadContinuation$.mockReturnValueOnce(of({
      items: [],
      exhausted: false,
      failed: true,
      degraded: true,
    }));
    videoContinuation.loadContinuation$.mockReturnValueOnce(of({
      items: [healthyVideo],
      exhausted: false,
      failed: false,
      degraded: false,
    }));

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [],
      source: 'top',
    }));

    expect(result.items).toEqual([healthyVideo]);
    expect(result.failed).toBe(false);
    expect(result.exhausted).toBe(false);
    expect(result.degraded).toBe(true);
  });

  it('sinaliza falha quando nenhuma fonte saudável consegue produzir candidato', async () => {
    const service = TestBed.inject(PublicMixedMediaContinuationService);

    photoContinuation.loadContinuation$.mockReturnValueOnce(of({
      items: [],
      exhausted: false,
      failed: true,
      degraded: true,
    }));
    videoContinuation.loadContinuation$.mockReturnValueOnce(of({
      items: [],
      exhausted: true,
      failed: false,
      degraded: false,
    }));

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [],
      source: 'latest',
    }));

    expect(result.items).toEqual([]);
    expect(result.failed).toBe(true);
    expect(result.exhausted).toBe(false);
    expect(result.degraded).toBe(true);
  });
});

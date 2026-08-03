// src/app/dashboard/principal/principal-feed.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunityPreviewRepository } from 'src/app/community/data-access/community-preview.repository';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { PublicVideoRankingQueryService } from 'src/app/core/services/media/public-video-ranking-query.service';
import { PrincipalFeedService } from './principal-feed.service';

const photo = {
  id: 'photo-1',
  ownerUid: 'owner-1',
  url: 'https://example.com/photo-1.jpg',
  createdAt: 100,
  publishedAt: 100,
  visibility: 'PUBLIC',
  orderIndex: 0,
};

const video = {
  id: 'video-1',
  ownerUid: 'owner-2',
  title: 'Vídeo público',
  url: 'https://example.com/video-1.mp4',
  posterUrl: 'https://example.com/video-1.jpg',
  publishedAt: 200,
};

describe('PrincipalFeedService', () => {
  const mediaQuery = {
    getLatestPublicPhotos$: vi.fn(),
  };
  const videoRanking = {
    loadPage$: vi.fn(),
  };
  const communityRepository = {
    getDiscoveryPage$: vi.fn(),
  };
  const globalError = {
    handleError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mediaQuery.getLatestPublicPhotos$.mockReturnValue(of([photo]));
    videoRanking.loadPage$.mockReturnValue(of({
      mode: 'latest',
      source: 'latest',
      items: [video],
      nextCursor: null,
      hasMore: false,
      loadedAt: Date.now(),
    }));
    communityRepository.getDiscoveryPage$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));

    TestBed.configureTestingModule({
      providers: [
        PrincipalFeedService,
        { provide: MediaPublicQueryService, useValue: mediaQuery },
        { provide: PublicVideoRankingQueryService, useValue: videoRanking },
        { provide: CommunityPreviewRepository, useValue: communityRepository },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });
  });

  it('entrega fotos e vídeos sem consultar espaços com a flag desligada', async () => {
    const service = TestBed.inject(PrincipalFeedService);
    const state = await firstValueFrom(
      service.state$.pipe(
        filter((value) => value.status !== 'loading'),
        take(1)
      )
    );

    expect(state.status).toBe('ready');
    expect(state.items.map((item) => item.id)).toEqual([
      'profile-video:owner-2:video-1',
      'profile-photo:owner-1:photo-1',
    ]);
    expect(state.videos).toEqual([video]);
    expect(videoRanking.loadPage$).toHaveBeenCalledWith({
      mode: 'latest',
      pageSize: 8,
      cursor: null,
      notifyOnError: false,
      propagateErrors: true,
    });
    expect(communityRepository.getDiscoveryPage$).not.toHaveBeenCalled();
  });

  it('mantém fotos quando a fonte de vídeos falha', async () => {
    videoRanking.loadPage$.mockReturnValue(
      throwError(() => new Error('video query failed'))
    );
    const service = TestBed.inject(PrincipalFeedService);
    const state = await firstValueFrom(
      service.state$.pipe(
        filter((value) => value.status !== 'loading'),
        take(1)
      )
    );

    expect(state.status).toBe('ready');
    expect(state.items.map((item) => item.id)).toEqual([
      'profile-photo:owner-1:photo-1',
    ]);
    expect(state.failedSources).toEqual(['videos']);
    expect(globalError.handleError).toHaveBeenCalledTimes(1);
  });

  it('falha fechado quando todas as fontes habilitadas falham', async () => {
    mediaQuery.getLatestPublicPhotos$.mockReturnValue(
      throwError(() => new Error('photo query failed'))
    );
    videoRanking.loadPage$.mockReturnValue(
      throwError(() => new Error('video query failed'))
    );
    const service = TestBed.inject(PrincipalFeedService);
    const state = await firstValueFrom(
      service.state$.pipe(
        filter((value) => value.status !== 'loading'),
        take(1)
      )
    );

    expect(state.status).toBe('error');
    expect(state.items).toEqual([]);
    expect(state.failedSources).toEqual(['profiles', 'videos']);
    expect(globalError.handleError).toHaveBeenCalledTimes(2);
  });
});

// src/app/dashboard/principal/principal-feed.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunityPreviewRepository } from 'src/app/community/data-access/community-preview.repository';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { PublicMediaRecentViewService } from 'src/app/core/services/media/public-media-recent-view.service';
import { PublicVideoRankingQueryService } from 'src/app/core/services/media/public-video-ranking-query.service';
import { CompatibleProfileCandidatesService } from 'src/app/dashboard/discovery/application/compatible-profile-candidates.service';
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
  mediaType: 'VIDEO',
  assetAccess: 'SIGNED_URL',
  posterAccess: 'SIGNED_URL',
  title: 'Vídeo recente',
  description: null,
  alt: 'Vídeo recente',
  mimeType: 'video/mp4',
  sizeBytes: 1_024,
  durationMs: 20_000,
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
  posterUrl: 'https://example.com/video-1.jpg',
  accessExpiresAt: 500,
};

describe('PrincipalFeedService', () => {
  const mediaQuery = {
    getLatestPublicPhotos$: vi.fn(),
    getRecentPublicPhotosByOwners$: vi.fn(),
    getRecentPublicVideoPreviewsByOwners$: vi.fn(),
  };
  const recentViews = {
    resolveRecentViewedKeys$: vi.fn(() => of([])),
  };
  const videoRanking = {
    loadPage$: vi.fn(),
  };
  const friendship = {
    watchFriends: vi.fn(),
  };
  const compatibleCandidates = {
    ownerUids$: of([] as string[]),
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
    mediaQuery.getRecentPublicPhotosByOwners$.mockReturnValue(of([]));
    mediaQuery.getRecentPublicVideoPreviewsByOwners$.mockReturnValue(of([]));
    recentViews.resolveRecentViewedKeys$.mockReturnValue(of([]));
    videoRanking.loadPage$.mockReturnValue(of({
      mode: 'latest',
      source: 'latest',
      items: [video],
      nextCursor: null,
      hasMore: false,
      loadedAt: Date.now(),
    }));
    friendship.watchFriends.mockReturnValue(of([]));
    communityRepository.getDiscoveryPage$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));

    TestBed.configureTestingModule({
      providers: [
        PrincipalFeedService,
        { provide: AuthSessionService, useValue: { uid$: of(null) } },
        { provide: FriendshipService, useValue: friendship },
        {
          provide: CompatibleProfileCandidatesService,
          useValue: compatibleCandidates,
        },
        { provide: PublicMediaRecentViewService, useValue: recentViews },
        { provide: MediaPublicQueryService, useValue: mediaQuery },
        { provide: PublicVideoRankingQueryService, useValue: videoRanking },
        { provide: CommunityPreviewRepository, useValue: communityRepository },
        { provide: GlobalErrorHandlerService, useValue: globalError },
      ],
    });
  });

  it('entrega foto e preview de vídeo sem consultar espaços com a flag desligada', async () => {
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
      pageSize: 12,
      cursor: null,
      propagateErrors: true,
      notifyOnError: false,
    });
    expect(friendship.watchFriends).not.toHaveBeenCalled();
    expect(recentViews.resolveRecentViewedKeys$).not.toHaveBeenCalled();
    expect(communityRepository.getDiscoveryPage$).not.toHaveBeenCalled();
  });

  it('mantém vídeos disponíveis quando a fonte de fotos falha', async () => {
    mediaQuery.getLatestPublicPhotos$.mockReturnValue(
      throwError(() => new Error('photo query failed'))
    );
    const service = TestBed.inject(PrincipalFeedService);
    const state = await firstValueFrom(
      service.state$.pipe(
        filter((value) => value.status !== 'loading'),
        take(1)
      )
    );

    expect(state.status).toBe('ready');
    expect(state.items.map((item) => item.kind)).toEqual(['profile-video']);
    expect(state.failedSources).toEqual(['photos']);
    expect(globalError.handleError).toHaveBeenCalledTimes(1);
  });

  it('entra em erro apenas quando todas as fontes-base habilitadas falham', async () => {
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
    expect(state.failedSources).toEqual(['photos', 'videos']);
    expect(globalError.handleError).toHaveBeenCalledTimes(2);
  });
});

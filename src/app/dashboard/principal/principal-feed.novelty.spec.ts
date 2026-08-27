import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunityPreviewRepository } from 'src/app/community/data-access/community-preview.repository';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { PublicMediaRecentViewService } from 'src/app/core/services/media/public-media-recent-view.service';
import { PublicVideoRankingQueryService } from 'src/app/core/services/media/public-video-ranking-query.service';
import { buildPublicMediaIdentity } from 'src/app/core/utils/media/public-media-identity';
import { CompatibleProfileCandidatesService } from 'src/app/dashboard/discovery/application/compatible-profile-candidates.service';
import { PrincipalFeedService } from './principal-feed.service';

const recentPhoto = {
  id: 'photo-recent',
  ownerUid: 'owner-photo',
  url: 'https://example.com/photo-recent.jpg',
  createdAt: 300,
  publishedAt: 300,
  visibility: 'PUBLIC',
  moderationStatus: 'APPROVED',
  orderIndex: 0,
} as any;

const unseenVideo = {
  id: 'video-unseen',
  ownerUid: 'owner-video',
  mediaType: 'VIDEO',
  assetAccess: 'SIGNED_URL',
  posterAccess: 'SIGNED_URL',
  title: 'Vídeo ainda não visto',
  description: null,
  alt: 'Vídeo ainda não visto',
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
  posterUrl: 'https://example.com/video-unseen.jpg',
  accessExpiresAt: 500,
};

describe('PrincipalFeedService / novidade por view recente', () => {
  const mediaQuery = {
    getLatestPublicPhotos$: vi.fn(() => of([recentPhoto])),
    getRecentPublicPhotosByOwners$: vi.fn(() => of([])),
    getRecentPublicVideoPreviewsByOwners$: vi.fn(() => of([])),
  };
  const recentViews = {
    resolveRecentViewedKeys$: vi.fn(),
  };
  const videoRanking = {
    loadPage$: vi.fn(() => of({
      mode: 'latest',
      source: 'latest',
      items: [unseenVideo],
      nextCursor: null,
      hasMore: false,
      loadedAt: Date.now(),
    })),
  };
  const friendship = {
    watchFriends: vi.fn(() => of([])),
  };
  const compatibleCandidates = {
    ownerUids$: of([] as string[]),
  };
  const communityRepository = {
    getDiscoveryPage$: vi.fn(() => of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    })),
  };
  const globalError = {
    handleError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        PrincipalFeedService,
        { provide: AuthSessionService, useValue: { uid$: of('viewer-1') } },
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

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('envia apenas candidatos atuais e adia o item retornado como recente', async () => {
    recentViews.resolveRecentViewedKeys$.mockReturnValue(of([
      buildPublicMediaIdentity(
        'PHOTO',
        recentPhoto.ownerUid,
        recentPhoto.id
      ),
    ]));

    const service = TestBed.inject(PrincipalFeedService);
    const state = await firstValueFrom(
      service.state$.pipe(
        filter((candidate) => candidate.status !== 'loading'),
        take(1)
      )
    );

    expect(recentViews.resolveRecentViewedKeys$).toHaveBeenCalledWith(
      [
        {
          mediaType: 'PHOTO',
          ownerUid: 'owner-photo',
          mediaId: 'photo-recent',
        },
        {
          mediaType: 'VIDEO',
          ownerUid: 'owner-video',
          mediaId: 'video-unseen',
        },
      ],
      { propagateErrors: true }
    );
    expect(state.items.map((item) => item.id)).toEqual([
      'profile-video:owner-video:video-unseen',
      'profile-photo:owner-photo:photo-recent',
    ]);
    expect(state.failedSources).toEqual([]);
  });

  it('mantém a ordem normal quando a checagem de novidade falha', async () => {
    recentViews.resolveRecentViewedKeys$.mockReturnValue(
      throwError(() => new Error('novelty unavailable'))
    );

    const service = TestBed.inject(PrincipalFeedService);
    const state = await firstValueFrom(
      service.state$.pipe(
        filter((candidate) => candidate.status !== 'loading'),
        take(1)
      )
    );

    expect(state.status).toBe('ready');
    expect(state.items.map((item) => item.id)).toEqual([
      'profile-photo:owner-photo:photo-recent',
      'profile-video:owner-video:video-unseen',
    ]);
    expect(state.failedSources).toEqual(['recentViews']);
  });
});

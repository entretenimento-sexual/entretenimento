import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunityPreviewRepository } from 'src/app/community/data-access/community-preview.repository';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { PublicMediaRecentViewService } from 'src/app/core/services/media/public-media-recent-view.service';
import { PublicVideoRankingQueryService } from 'src/app/core/services/media/public-video-ranking-query.service';
import { CompatibleProfileCandidatesService } from 'src/app/dashboard/discovery/application/compatible-profile-candidates.service';
import { PrincipalFeedService } from './principal-feed.service';

describe('PrincipalFeedService / refresh personalizado', () => {
  const mediaQuery = {
    getLatestPublicPhotos$: vi.fn(() => of([])),
    getRecentPublicPhotosByOwners$: vi.fn(() => of([])),
    getRecentPublicVideoPreviewsByOwners$: vi.fn(() => of([])),
  };
  const recentViews = {
    resolveRecentViewedKeys$: vi.fn(() => of([])),
  };
  const videoRanking = {
    loadPage$: vi.fn(() => of({
      mode: 'latest',
      source: 'latest',
      items: [],
      nextCursor: null,
      hasMore: false,
      loadedAt: Date.now(),
    })),
  };
  const friendship = {
    watchFriends: vi.fn(() => of([
      {
        friendUid: 'friend-1',
        since: 1,
        status: 'active',
      },
    ])),
  };
  const compatibleCandidates = {
    ownerUids$: of(['compatible-1']),
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
        {
          provide: AuthSessionService,
          useValue: { uid$: of('viewer-1') },
        },
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

  it('faz um único lote para conexão + compatível em cada refresh explícito', () => {
    const service = TestBed.inject(PrincipalFeedService);
    const subscription = service.state$.subscribe();
    const expectedOwners = ['friend-1', 'compatible-1'];

    expect(mediaQuery.getRecentPublicPhotosByOwners$).toHaveBeenCalledTimes(1);
    expect(
      mediaQuery.getRecentPublicVideoPreviewsByOwners$
    ).toHaveBeenCalledTimes(1);
    expect(mediaQuery.getRecentPublicPhotosByOwners$).toHaveBeenLastCalledWith(
      expectedOwners,
      12,
      { propagateErrors: true }
    );
    expect(
      mediaQuery.getRecentPublicVideoPreviewsByOwners$
    ).toHaveBeenLastCalledWith(
      expectedOwners,
      12,
      { propagateErrors: true }
    );

    service.refresh();

    expect(mediaQuery.getRecentPublicPhotosByOwners$).toHaveBeenCalledTimes(2);
    expect(
      mediaQuery.getRecentPublicVideoPreviewsByOwners$
    ).toHaveBeenCalledTimes(2);

    subscription.unsubscribe();
  });
});

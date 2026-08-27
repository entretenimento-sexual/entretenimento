// src/app/explore/services/explore-feed.service.spec.ts

import { TestBed } from '@angular/core/testing';
import { filter, firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { PublicVideoRankingQueryService } from 'src/app/core/services/media/public-video-ranking-query.service';
import { CompatibleProfileCandidatesService } from 'src/app/dashboard/discovery/application/compatible-profile-candidates.service';
import { PublicProfileCard } from 'src/app/dashboard/discovery/models/public-profile-card.model';

import { ExploreFeedService } from './explore-feed.service';

describe('ExploreFeedService', () => {
  const compatibleCards: PublicProfileCard[] = Array.from(
    { length: 8 },
    (_, index) => ({
      uid: `candidate-${index + 1}`,
      nickname: `Candidate ${index + 1}`,
      gender: 'man',
      orientation: index % 2 === 0 ? 'homosexual' : 'pansexual',
      compatibilityReady: true,
      updatedAt: 1_700_000_000_000 - index,
    })
  );

  const videoA = {
    id: 'video-a',
    ownerUid: 'owner-a',
    title: 'Vídeo A',
  } as any;
  const videoB = {
    id: 'video-b',
    ownerUid: 'owner-b',
    title: 'Vídeo B',
  } as any;

  const mediaPublicQueryMock = {
    getBoostedPublicPhotos$: vi.fn(() => of([])),
    getTopPublicPhotos$: vi.fn(() => of([])),
    getLatestPublicPhotos$: vi.fn(() => of([])),
  };

  const publicVideoRankingMock = {
    loadPage$: vi.fn(),
  };

  /**
   * Intencionalmente não oferece getAllUsers$().
   * Se o Explore voltar a ler a coleção integral, a spec falhará.
   */
  const discoveryQueryMock = {
    getProfilesByUids$: vi.fn(() => of([])),
  };

  const compatibleCandidatesMock = {
    profiles$: of(compatibleCards),
  };

  let service: ExploreFeedService;

  beforeEach(() => {
    vi.clearAllMocks();
    publicVideoRankingMock.loadPage$.mockImplementation(
      (rankingRequest: { mode: 'top' | 'latest' }) =>
        of({
          mode: rankingRequest.mode,
          source: rankingRequest.mode,
          items: rankingRequest.mode === 'top'
            ? [videoA]
            : [videoA, videoB],
          nextCursor: null,
          hasMore: false,
          loadedAt: 1_700_000_000_000,
        })
    );

    TestBed.configureTestingModule({
      providers: [
        {
          provide: MediaPublicQueryService,
          useValue: mediaPublicQueryMock,
        },
        {
          provide: PublicVideoRankingQueryService,
          useValue: publicVideoRankingMock,
        },
        {
          provide: UserDiscoveryQueryService,
          useValue: discoveryQueryMock,
        },
        {
          provide: CompatibleProfileCandidatesService,
          useValue: compatibleCandidatesMock,
        },
      ],
    });

    service = TestBed.inject(ExploreFeedService);
  });

  it('usa o pool compartilhado e limita o Explore a seis perfis', async () => {
    const profiles = await firstValueFrom(service.compatibleProfiles$);

    expect(profiles).toHaveLength(6);
    expect(profiles.map((profile) => profile.uid)).toEqual(
      compatibleCards.slice(0, 6).map((profile) => profile.uid)
    );
  });

  it('não consulta todos os perfis para montar compatibilidade', async () => {
    await firstValueFrom(service.compatibleProfiles$);

    expect('getAllUsers$' in discoveryQueryMock).toBe(false);
    expect(discoveryQueryMock.getProfilesByUids$).not.toHaveBeenCalled();
  });

  it('combina top e latest sem duplicar vídeos e mantém signed URL fora do NgRx', async () => {
    const state = await firstValueFrom(
      service.videoHighlightsState$.pipe(
        filter((candidate) => candidate.status !== 'loading')
      )
    );

    expect(state.status).toBe('ready');
    expect(state.items).toEqual([videoA, videoB]);
    expect(publicVideoRankingMock.loadPage$).toHaveBeenCalledWith({
      mode: 'top',
      pageSize: 4,
      propagateErrors: true,
    });
    expect(publicVideoRankingMock.loadPage$).toHaveBeenCalledWith({
      mode: 'latest',
      pageSize: 4,
      propagateErrors: true,
    });
  });

  it('mantém latest disponível quando o ranking top falha', async () => {
    publicVideoRankingMock.loadPage$.mockImplementation(
      (rankingRequest: { mode: 'top' | 'latest' }) =>
        rankingRequest.mode === 'top'
          ? throwError(() => new Error('top unavailable'))
          : of({
            mode: 'latest',
            source: 'latest',
            items: [videoB],
            nextCursor: null,
            hasMore: false,
            loadedAt: 1_700_000_000_000,
          })
    );

    const state = await firstValueFrom(
      service.videoHighlightsState$.pipe(
        filter((candidate) => candidate.status !== 'loading')
      )
    );

    expect(state).toEqual({
      status: 'ready',
      items: [videoB],
    });
    expect(publicVideoRankingMock.loadPage$).toHaveBeenNthCalledWith(1, {
      mode: 'top',
      pageSize: 4,
      propagateErrors: true,
    });
    expect(publicVideoRankingMock.loadPage$).toHaveBeenNthCalledWith(2, {
      mode: 'latest',
      pageSize: 4,
      propagateErrors: true,
    });
  });
});

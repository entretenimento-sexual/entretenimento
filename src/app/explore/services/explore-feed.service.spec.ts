// src/app/explore/services/explore-feed.service.spec.ts

import { TestBed } from '@angular/core/testing';
import { filter, firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { PublicPhotoRankingQueryService } from 'src/app/core/services/media/public-photo-ranking-query.service';
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

  const publicPhotoRankingMock = {
    loadPage$: vi.fn(),
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
    publicPhotoRankingMock.loadPage$.mockImplementation(
      (rankingRequest: {
        mode: 'top' | 'latest' | 'boosted';
        pageSize: number;
        cursor?: unknown;
      }) =>
        of({
          mode: rankingRequest.mode,
          source: rankingRequest.mode,
          items: [],
          nextCursor: null,
          hasMore: false,
          loadedAt: 1_700_000_000_000,
        })
    );

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
          provide: PublicPhotoRankingQueryService,
          useValue: publicPhotoRankingMock,
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

  it('usa ranking cursorizado para fotos do Explore', async () => {
    await firstValueFrom(service.boostedPhotos$);
    await firstValueFrom(service.topPhotos$);

    expect(publicPhotoRankingMock.loadPage$).toHaveBeenCalledWith({
      mode: 'boosted',
      pageSize: 8,
      propagateErrors: true,
    });
    expect(publicPhotoRankingMock.loadPage$).toHaveBeenCalledWith({
      mode: 'top',
      pageSize: 12,
      propagateErrors: true,
    });
  });

  it('preserva pool recente de 48 fotos em duas páginas cursorizadas', async () => {
    const firstCursor = {
      mode: 'latest',
      score: 0,
      publishedAt: 123,
      documentPath: 'public_profiles/a/public_photos/p24',
    };

    publicPhotoRankingMock.loadPage$.mockImplementation(
      (rankingRequest: {
        mode: 'top' | 'latest' | 'boosted';
        pageSize: number;
        cursor?: unknown;
      }) => {
        if (rankingRequest.mode !== 'latest') {
          return of({
            mode: rankingRequest.mode,
            source: rankingRequest.mode,
            items: [],
            nextCursor: null,
            hasMore: false,
            loadedAt: 1_700_000_000_000,
          });
        }

        const offset = rankingRequest.cursor ? 24 : 0;
        return of({
          mode: 'latest',
          source: 'latest',
          items: Array.from({ length: 24 }, (_, index) => ({
            id: `photo-${offset + index + 1}`,
            ownerUid: `owner-${offset + index + 1}`,
          })),
          nextCursor: rankingRequest.cursor ? null : firstCursor,
          hasMore: !rankingRequest.cursor,
          loadedAt: 1_700_000_000_000,
        });
      }
    );

    const vm = await firstValueFrom(service.vm$);

    expect(vm.latestPhotos).toHaveLength(16);
    expect(publicPhotoRankingMock.loadPage$).toHaveBeenCalledWith({
      mode: 'latest',
      pageSize: 24,
      propagateErrors: true,
    });
    expect(publicPhotoRankingMock.loadPage$).toHaveBeenCalledWith({
      mode: 'latest',
      pageSize: 24,
      cursor: firstCursor,
      propagateErrors: true,
    });
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

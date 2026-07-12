// src/app/explore/services/explore-feed.service.spec.ts

import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { DiscoveryCardEnrichmentService } from 'src/app/dashboard/discovery/application/discovery-card-enrichment.service';
import {
  DiscoveryFeedRequest,
  buildDiscoveryFeedQueryKey,
} from 'src/app/dashboard/discovery/models/discovery-feed-page.model';
import { PublicProfileCard } from 'src/app/dashboard/discovery/models/public-profile-card.model';
import * as DiscoveryActions from 'src/app/store/actions/actions.discovery/discovery-feed.actions';
import { emptyDiscoveryFeedSlice } from 'src/app/store/states/states.discovery/discovery-feed.state';

import { ExploreFeedService } from './explore-feed.service';

describe('ExploreFeedService', () => {
  const viewerUid = 'viewer-1';
  const request: DiscoveryFeedRequest = {
    viewerUid,
    mode: 'compatible',
    pageSize: 24,
  };
  const queryKey = buildDiscoveryFeedQueryKey(request);

  const currentUser = {
    uid: viewerUid,
    nickname: 'Viewer',
    gender: 'man',
    orientation: 'homosexual',
  } as IUserDados;

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

  const mediaPublicQueryMock = {
    getBoostedPublicPhotos$: vi.fn(() => of([])),
    getTopPublicPhotos$: vi.fn(() => of([])),
    getLatestPublicPhotos$: vi.fn(() => of([])),
  };

  /**
   * Intencionalmente não oferece getAllUsers$().
   * Se o Explore voltar a ler a coleção integral, a spec falhará.
   */
  const discoveryQueryMock = {
    getProfilesByUids$: vi.fn(() => of([])),
  };

  const accessControlMock = {
    authUid$: of(viewerUid),
    canRunApp$: of(true),
  };

  const currentUserStoreMock = {
    user$: of(currentUser),
  };

  const cardEnrichmentMock = {
    buildCardsResult: vi.fn(
      ({ profiles }: { profiles: readonly PublicProfileCard[] }) => ({
        profiles: [...profiles],
        rejected: [],
        debugSummary: {},
      })
    ),
  };

  let store: MockStore;
  let service: ExploreFeedService;

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          initialState: {
            discoveryFeeds: {
              byQuery: {
                [queryKey]: {
                  ...emptyDiscoveryFeedSlice,
                  items: compatibleCards,
                  reachedEnd: true,
                  lastServerSyncAt: 1_700_000_000_000,
                },
              },
            },
          },
        }),
        {
          provide: MediaPublicQueryService,
          useValue: mediaPublicQueryMock,
        },
        {
          provide: UserDiscoveryQueryService,
          useValue: discoveryQueryMock,
        },
        {
          provide: AccessControlService,
          useValue: accessControlMock,
        },
        {
          provide: CurrentUserStoreService,
          useValue: currentUserStoreMock,
        },
        {
          provide: DiscoveryCardEnrichmentService,
          useValue: cardEnrichmentMock,
        },
      ],
    });

    store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    service = TestBed.inject(ExploreFeedService);
  });

  it('deve solicitar a primeira página do modo compatível', () => {
    expect(store.dispatch).toHaveBeenCalledWith(
      DiscoveryActions.loadDiscoveryFirstPage({ request })
    );
  });

  it('deve usar o slice paginado e limitar o Explore a seis perfis', async () => {
    const profiles = await firstValueFrom(service.compatibleProfiles$);

    expect(profiles).toHaveLength(6);
    expect(profiles.map((profile) => profile.uid)).toEqual(
      compatibleCards.slice(0, 6).map((profile) => profile.uid)
    );

    expect(cardEnrichmentMock.buildCardsResult).toHaveBeenCalledWith(
      expect.objectContaining({
        currentUid: viewerUid,
        mode: 'compatible',
        applyVisibility: true,
      })
    );
  });

  it('não deve consultar todos os perfis para montar compatibilidade', async () => {
    await firstValueFrom(service.compatibleProfiles$);

    expect('getAllUsers$' in discoveryQueryMock).toBe(false);
    expect(discoveryQueryMock.getProfilesByUids$).not.toHaveBeenCalled();
  });
});

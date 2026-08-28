import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { UserPresenceQueryService } from 'src/app/core/services/data-handling/queries/user-presence.query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { GeolocationTrackingService } from 'src/app/core/services/geolocation/geolocation-tracking.service';
import { emptyDiscoveryFeedSlice } from 'src/app/store/states/states.discovery/discovery-feed.state';

import {
  DiscoveryVisibleProfileLocation,
  DiscoveryVisibleProfileLocationRepository,
} from '../data-access/discovery-visible-profile-location.repository';
import { DiscoveryCardEnrichmentService } from './discovery-card-enrichment.service';
import { DiscoveryPublicProfilesFacade } from './discovery-public-profiles.facade';

describe('DiscoveryPublicProfilesFacade', () => {
  const runtimeLocation = {
    latitude: -22.9309,
    longitude: -43.3536,
    accuracy: 50,
  } as any;

  const viewer = {
    uid: 'viewer',
    nickname: 'viewer',
    email: null,
    photoURL: null,
    role: 'free',
    emailVerified: true,
    lastLogin: 0,
    descricao: '',
    isSubscriber: false,
    latitude: 0,
    longitude: 0,
  } as any;

  const storeMock = {
    select: vi.fn(() => of(emptyDiscoveryFeedSlice)),
    dispatch: vi.fn(),
  };

  const cardEnrichmentMock = {
    buildCardsResult: vi.fn(() => ({
      profiles: [],
      rejected: [],
      scores: [],
      debugSummary: {},
    })),
  };

  const geolocationTrackingMock = {
    snapshot$: of(runtimeLocation),
    getLastSnapshot: vi.fn(() => runtimeLocation),
  };

  const visibleLocationRepositoryMock = {
    watchByUids$: vi.fn(() =>
      of<readonly DiscoveryVisibleProfileLocation[]>([])
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.select.mockReturnValue(of(emptyDiscoveryFeedSlice));
    visibleLocationRepositoryMock.watchByUids$.mockReturnValue(of([]));
    cardEnrichmentMock.buildCardsResult.mockReturnValue({
      profiles: [],
      rejected: [],
      scores: [],
      debugSummary: {},
    });

    TestBed.configureTestingModule({
      providers: [
        DiscoveryPublicProfilesFacade,
        { provide: Store, useValue: storeMock },
        {
          provide: AccessControlService,
          useValue: {
            authUid$: of('viewer'),
            canRunApp$: of(true),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: { user$: of(viewer) },
        },
        {
          provide: UserPresenceQueryService,
          useValue: { getOnlineUsers$: vi.fn(() => of([])) },
        },
        {
          provide: DiscoveryCardEnrichmentService,
          useValue: cardEnrichmentMock,
        },
        {
          provide: GeolocationTrackingService,
          useValue: geolocationTrackingMock,
        },
        {
          provide: DiscoveryVisibleProfileLocationRepository,
          useValue: visibleLocationRepositoryMock,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });
  });

  it('envia a localização runtime reativa do viewer para o enriquecimento dos cards', async () => {
    const facade = TestBed.inject(DiscoveryPublicProfilesFacade);

    await firstValueFrom(facade.state$);

    expect(cardEnrichmentMock.buildCardsResult).toHaveBeenCalledWith(
      expect.objectContaining({
        currentUid: 'viewer',
        currentUser: viewer,
        fallbackLocation: runtimeLocation,
      })
    );
  });

  it('não tenta persistir projeção pública pelo cliente', async () => {
    const facade = TestBed.inject(DiscoveryPublicProfilesFacade);

    await firstValueFrom(facade.state$);

    expect('persistPublicLocation$' in geolocationTrackingMock).toBe(false);
  });

  it('sobrepõe somente a localização pública dos perfis visíveis em tempo real', async () => {
    storeMock.select.mockReturnValue(
      of({
        ...emptyDiscoveryFeedSlice,
        items: [
          {
            uid: 'profile-1',
            nickname: 'Profile 1',
            latitude: null,
            longitude: null,
            geohash: null,
          },
        ],
        reachedEnd: true,
      } as any)
    );

    visibleLocationRepositoryMock.watchByUids$.mockReturnValue(
      of([
        {
          uid: 'profile-1',
          latitude: -22.93,
          longitude: -43.35,
          geohash: '75cm',
        },
      ])
    );

    const facade = TestBed.inject(DiscoveryPublicProfilesFacade);
    await firstValueFrom(facade.state$);

    expect(visibleLocationRepositoryMock.watchByUids$).toHaveBeenCalledWith([
      'profile-1',
    ]);
    expect(cardEnrichmentMock.buildCardsResult).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            uid: 'profile-1',
            latitude: -22.93,
            longitude: -43.35,
            geohash: '75cm',
          }),
        ],
      })
    );
  });
});

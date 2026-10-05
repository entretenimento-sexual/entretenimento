import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { UserPresenceQueryService } from 'src/app/core/services/data-handling/queries/user-presence.query.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { GeolocationTrackingService } from 'src/app/core/services/geolocation/geolocation-tracking.service';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
import { emptyDiscoveryFeedSlice } from 'src/app/store/states/states.discovery/discovery-feed.state';

import {
  DiscoveryVisibleProfileLocation,
  DiscoveryVisibleProfileLocationRepository,
} from '../data-access/discovery-visible-profile-location.repository';
import { DiscoveryCardEnrichmentService, type DiscoveryCardEnrichmentResult } from './discovery-card-enrichment.service';
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

  const emptyDebugSummary: DiscoveryCardEnrichmentResult['debugSummary'] = {
    mode: 'all',
    sourceTotal: 0,
    candidateTotal: 0,
    acceptedTotal: 0,
    rejectedTotal: 0,
    onlineTotal: 0,
    withDistanceTotal: 0,
    withMediaTotal: 0,
    withVideoTotal: 0,
    rejectedByReason: {},
    topScores: [],
  };

  const cardEnrichmentMock = {
    buildCardsResult: vi.fn(
      (): DiscoveryCardEnrichmentResult => ({
        profiles: [],
        rejected: [],
        scores: [],
        debugSummary: emptyDebugSummary,
      })
    ),
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

  const intentStatusMock = {
    watchActiveStatusesForUserRegion$: vi.fn(() => of([])),
    watchActiveStatusesForRegion$: vi.fn(() => of([])),
    watchCurrentStatus$: vi.fn(() => of(null)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.select.mockReturnValue(of(emptyDiscoveryFeedSlice));
    visibleLocationRepositoryMock.watchByUids$.mockReturnValue(of([]));
    intentStatusMock.watchActiveStatusesForUserRegion$.mockReturnValue(of([]));
    intentStatusMock.watchActiveStatusesForRegion$.mockReturnValue(of([]));
    intentStatusMock.watchCurrentStatus$.mockReturnValue(of(null));
    cardEnrichmentMock.buildCardsResult.mockReturnValue({
      profiles: [],
      rejected: [],
      scores: [],
      debugSummary: emptyDebugSummary,
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
          provide: UserIntentStatusService,
          useValue: intentStatusMock,
        },
        {
          provide: DiscoveryVisibleProfileLocationRepository,
          useValue: visibleLocationRepositoryMock,
        },
        {
          provide: ApplicationErrorService,
          useValue: { report: vi.fn() },
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

  it('não reavalia assurance etário dos cards já autorizados pelo backend', async () => {
    storeMock.select.mockReturnValue(
      of({
        ...emptyDiscoveryFeedSlice,
        items: [
          {
            uid: 'profile-legacy-age',
            nickname: 'Perfil ativo',
            ageEligibilityValidUntil: Date.now() - 1,
            ageEligibilityVerifiedAdult: false,
          },
        ],
        reachedEnd: true,
      } as any)
    );

    cardEnrichmentMock.buildCardsResult.mockReturnValue({
      profiles: [{ uid: 'profile-legacy-age', nickname: 'Perfil ativo' }],
      rejected: [],
      scores: [],
      debugSummary: emptyDebugSummary,
    });

    const facade = TestBed.inject(DiscoveryPublicProfilesFacade);
    const state = await firstValueFrom(facade.state$);

    expect(state.profiles[0]).toMatchObject({ uid: 'profile-legacy-age' });
  });

  it('sobrepõe disponibilidade temporária sem alterar o ranking do card', async () => {
    storeMock.select.mockReturnValue(
      of({
        ...emptyDiscoveryFeedSlice,
        items: [
          {
            uid: 'profile-1',
            nickname: 'Profile 1',
          },
        ],
        reachedEnd: true,
      } as any)
    );

    cardEnrichmentMock.buildCardsResult.mockReturnValue({
      profiles: [{ uid: 'profile-1', nickname: 'Profile 1' }],
      rejected: [],
      scores: [],
      debugSummary: emptyDebugSummary,
    });

    intentStatusMock.watchActiveStatusesForRegion$.mockReturnValue(
      of([
        {
          id: 'current_profile-1',
          uid: 'profile-1',
          profile: { uid: 'profile-1', nickname: 'Profile 1' },
          availability: 'available_now',
          visibility: 'public_discovery',
          destination: {
            kind: 'region',
            label: 'Rio de Janeiro',
            region: { uf: 'RJ', city: 'rio de janeiro' },
          },
          moderation: { state: 'active' },
          startsAt: Date.now() - 1_000,
          expiresAt: Date.now() + 60_000,
          destinationLabel: 'Rio de Janeiro',
          availabilityLabel: 'Disponível agora',
          expiresInLabel: 'Expira em até 1h',
          isActive: true,
        },
      ] as any)
    );
    intentStatusMock.watchCurrentStatus$.mockReturnValue(
      of({
        id: 'current_viewer',
        uid: 'viewer',
        profile: { uid: 'viewer', nickname: 'viewer' },
        availability: 'available_now',
        visibility: 'public_discovery',
        destination: {
          kind: 'region',
          label: 'Rio de Janeiro',
          region: { uf: 'RJ', city: 'rio de janeiro' },
        },
        moderation: { state: 'active' },
        startsAt: Date.now() - 1_000,
        expiresAt: Date.now() + 60_000,
        ageEligibilityValidUntil: Date.now() + 60_000,
        destinationLabel: 'Rio de Janeiro',
        availabilityLabel: 'Disponível agora',
        expiresInLabel: 'Expira em até 1h',
        isActive: true,
      } as any)
    );

    const facade = TestBed.inject(DiscoveryPublicProfilesFacade);
    const state = await firstValueFrom(facade.state$);

    expect(intentStatusMock.watchActiveStatusesForRegion$).toHaveBeenCalledWith(
      { uf: 'RJ', city: 'rio de janeiro' },
      expect.objectContaining({
        ownerUids: ['profile-1'],
      })
    );
    expect(state.profiles[0]).toMatchObject({
      uid: 'profile-1',
      intentAvailability: 'available_now',
      mutualAvailableNow: true,
    });
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

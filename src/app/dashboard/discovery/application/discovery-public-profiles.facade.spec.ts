import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { BehaviorSubject, firstValueFrom, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { UserPresenceQueryService } from 'src/app/core/services/data-handling/queries/user-presence.query.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { GeolocationTrackingService } from 'src/app/core/services/geolocation/geolocation-tracking.service';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
import { emptyDiscoveryFeedSlice } from 'src/app/store/states/states.discovery/discovery-feed.state';

import {
  DiscoveryVisibleProfileLocation,
  DiscoveryVisibleProfileLocationRepository,
} from '../data-access/discovery-visible-profile-location.repository';
import { DiscoveryCardEnrichmentService, type DiscoveryCardEnrichmentResult } from './discovery-card-enrichment.service';
import { DiscoveryPublicProfilesFacade } from './discovery-public-profiles.facade';
import { DiscoveryPublicProfilesRepository } from '../data-access/discovery-public-profiles.repository';
import * as DiscoveryActions from 'src/app/store/actions/actions.discovery/discovery-feed.actions';

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

  const ownBlockedUids$ = new BehaviorSubject<readonly string[]>([]);
  const friendshipMock = {
    watchBlockedUids: vi.fn(() => ownBlockedUids$.asObservable()),
  };

  const repoMock = {
    invalidateViewerCache$: vi.fn(() => of(void 0)),
  };

  const applicationErrorMock = { report: vi.fn() };

  const intentStatusMock = {
    watchActiveStatusesForUserRegion$: vi.fn(() => of([])),
    watchActiveStatusesForRegion$: vi.fn(() => of([])),
    watchCurrentStatus$: vi.fn(() => of(null)),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ownBlockedUids$.next([]);
    friendshipMock.watchBlockedUids.mockReturnValue(ownBlockedUids$.asObservable());
    repoMock.invalidateViewerCache$.mockReturnValue(of(void 0));
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
          provide: FriendshipService,
          useValue: friendshipMock,
        },
        {
          provide: DiscoveryPublicProfilesRepository,
          useValue: repoMock,
        },
        {
          provide: ApplicationErrorService,
          useValue: applicationErrorMock,
        },
      ],
    });
  });


  it('oculta imediatamente card bloqueado e invalida NgRx + cache somente do viewer', async () => {
    storeMock.select.mockReturnValue(of({
      ...emptyDiscoveryFeedSlice,
      items: [{ uid: 'profile-1', nickname: 'Primeiro' }, { uid: 'profile-2', nickname: 'Segundo' }],
      reachedEnd: true,
    } as any));
    cardEnrichmentMock.buildCardsResult.mockReturnValue({
      profiles: [{ uid: 'profile-1', nickname: 'Primeiro' }, { uid: 'profile-2', nickname: 'Segundo' }],
      rejected: [],
      scores: [],
      debugSummary: emptyDebugSummary,
    });

    const facade = TestBed.inject(DiscoveryPublicProfilesFacade);
    const observed: string[][] = [];
    const sub = facade.state$.subscribe((state) => {
      observed.push(state.profiles.map((card) => card.uid));
    });
    expect(observed.at(-1)).toEqual(['profile-1', 'profile-2']);
    expect(friendshipMock.watchBlockedUids).toHaveBeenCalledTimes(1);

    ownBlockedUids$.next(['profile-2']);
    expect(observed.at(-1)).toEqual(['profile-1']);
    expect(storeMock.dispatch).toHaveBeenCalledWith(DiscoveryActions.clearDiscoveryFeeds());
    expect(repoMock.invalidateViewerCache$).toHaveBeenCalledWith('viewer');
    expect(storeMock.dispatch).toHaveBeenCalledWith(DiscoveryActions.loadDiscoveryFirstPage({
      request: { viewerUid: 'viewer', mode: 'all', pageSize: 24 },
      bypassCache: true,
    }));

    ownBlockedUids$.next(['profile-2']);
    expect(repoMock.invalidateViewerCache$).toHaveBeenCalledTimes(1);
    expect(friendshipMock.watchBlockedUids).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });


  it('esconde cache enquanto aguarda a primeira confirmação do listener', () => {
    const delayed = new Subject<readonly string[]>();
    friendshipMock.watchBlockedUids.mockReturnValue(delayed.asObservable());
    storeMock.select.mockReturnValue(of({
      ...emptyDiscoveryFeedSlice,
      items: [{ uid: 'profile-1', nickname: 'Primeiro' }],
    } as any));
    cardEnrichmentMock.buildCardsResult.mockReturnValue({
      profiles: [{ uid: 'profile-1', nickname: 'Primeiro' }],
      rejected: [],
      scores: [],
      debugSummary: emptyDebugSummary,
    });

    const facade = TestBed.inject(DiscoveryPublicProfilesFacade);
    const states: Array<{ loading: boolean; visible: number }> = [];
    const sub = facade.state$.subscribe((state) => states.push({
      loading: state.loading,
      visible: state.profiles.length,
    }));

    expect(states.at(-1)).toEqual({ loading: true, visible: 0 });
    delayed.next([]);
    expect(states.at(-1)).toEqual({ loading: false, visible: 1 });
    sub.unsubscribe();
  });

  it('não expõe cards em falha de leitura e permite retentar o observador', async () => {
    friendshipMock.watchBlockedUids
      .mockImplementationOnce(() => throwError(() => new Error('offline')))
      .mockImplementation(() => ownBlockedUids$.asObservable());
    storeMock.select.mockReturnValue(of({
      ...emptyDiscoveryFeedSlice,
      items: [{ uid: 'profile-1', nickname: 'Primeiro' }],
    } as any));
    cardEnrichmentMock.buildCardsResult.mockReturnValue({
      profiles: [{ uid: 'profile-1', nickname: 'Primeiro' }],
      rejected: [],
      scores: [],
      debugSummary: emptyDebugSummary,
    });

    const facade = TestBed.inject(DiscoveryPublicProfilesFacade);
    const state = await firstValueFrom(facade.state$);
    expect(state.profiles).toEqual([]);
    expect(state.errorMessage).toContain('Não foi possível verificar');
    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        operation: 'DiscoveryPublicProfilesFacade.watchBlockedUids',
      })
    );
    facade.retry();
    const next = await firstValueFrom(facade.state$);
    expect(next.profiles.map((card) => card.uid)).toEqual(['profile-1']);
    expect(friendshipMock.watchBlockedUids).toHaveBeenCalledTimes(2);
  });

  it('bloqueio já ativo na entrada também descarta páginas persistidas antigas', () => {
    ownBlockedUids$.next(['profile-1']);
    TestBed.inject(DiscoveryPublicProfilesFacade);

    expect(repoMock.invalidateViewerCache$).toHaveBeenCalledOnce();
    expect(storeMock.dispatch).toHaveBeenCalledWith(
      DiscoveryActions.clearDiscoveryFeeds()
    );
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

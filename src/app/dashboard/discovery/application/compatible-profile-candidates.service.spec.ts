import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import * as DiscoveryActions from 'src/app/store/actions/actions.discovery/discovery-feed.actions';
import { emptyDiscoveryFeedSlice } from 'src/app/store/states/states.discovery/discovery-feed.state';

import {
  DiscoveryFeedRequest,
  buildDiscoveryFeedQueryKey,
} from '../models/discovery-feed-page.model';
import type { PublicProfileCard } from '../models/public-profile-card.model';
import { CompatibleProfileCandidatesService } from './compatible-profile-candidates.service';
import { DiscoveryCardEnrichmentService } from './discovery-card-enrichment.service';

describe('CompatibleProfileCandidatesService', () => {
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
    { length: 14 },
    (_, index) => ({
      uid: `candidate-${index + 1}`,
      nickname: `Candidate ${index + 1}`,
      gender: 'man',
      orientation: index % 2 === 0 ? 'homosexual' : 'pansexual',
      compatibilityReady: true,
      updatedAt: 1_700_000_000_000 - index,
    })
  );

  const accessControl = {
    authUid$: of(viewerUid),
    canRunApp$: of(true),
  };
  const currentUserStore = {
    user$: of(currentUser),
  };
  const cardEnrichment = {
    buildCardsResult: vi.fn(
      ({ profiles }: { profiles: readonly PublicProfileCard[] }) => ({
        profiles: [...profiles],
        rejected: [],
        scores: [],
        debugSummary: {},
      })
    ),
  };

  let store: MockStore;

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        CompatibleProfileCandidatesService,
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
        { provide: AccessControlService, useValue: accessControl },
        { provide: CurrentUserStoreService, useValue: currentUserStore },
        { provide: DiscoveryCardEnrichmentService, useValue: cardEnrichment },
      ],
    });

    store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
  });

  it('solicita a primeira página no modo compatível', () => {
    TestBed.inject(CompatibleProfileCandidatesService);

    expect(store.dispatch).toHaveBeenCalledWith(
      DiscoveryActions.loadDiscoveryFirstPage({ request })
    );
  });

  it('mantém um pool compartilhado limitado a doze perfis elegíveis', async () => {
    const service = TestBed.inject(CompatibleProfileCandidatesService);
    const profiles = await firstValueFrom(service.profiles$);

    expect(profiles).toHaveLength(12);
    expect(profiles.map((profile) => profile.uid)).toEqual(
      compatibleCards.slice(0, 12).map((profile) => profile.uid)
    );
    expect(cardEnrichment.buildCardsResult).toHaveBeenCalledWith(
      expect.objectContaining({
        currentUid: viewerUid,
        mode: 'compatible',
        applyVisibility: true,
      })
    );
  });

  it('expõe somente UIDs para consumidores de mídia', async () => {
    const service = TestBed.inject(CompatibleProfileCandidatesService);
    const ownerUids = await firstValueFrom(service.ownerUids$);

    expect(ownerUids).toEqual(
      compatibleCards.slice(0, 12).map((profile) => profile.uid)
    );
  });

  it('solicita próxima página enquanto o pool compatível não estiver completo', async () => {
    const service = TestBed.inject(CompatibleProfileCandidatesService);

    store.setState({
      discoveryFeeds: {
        byQuery: {
          [queryKey]: {
            ...emptyDiscoveryFeedSlice,
            items: compatibleCards.slice(0, 2),
            nextCursor: {
              updatedAtMs: 1_699_999_999_999,
              uid: 'candidate-2',
            },
            reachedEnd: false,
            lastServerSyncAt: 1_700_000_000_000,
          },
        },
      },
    } as any);
    vi.mocked(store.dispatch).mockClear();

    const profiles = await firstValueFrom(service.profiles$);

    expect(profiles).toHaveLength(2);
    expect(store.dispatch).toHaveBeenCalledWith(
      DiscoveryActions.loadDiscoveryNextPage({ request })
    );
  });
});

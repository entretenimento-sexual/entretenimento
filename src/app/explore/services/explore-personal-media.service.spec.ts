import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PublicMediaOwnerPageQueryService } from 'src/app/core/services/media/public-media-owner-page-query.service';
import { CompatibleProfileCandidatesService } from 'src/app/dashboard/discovery/application/compatible-profile-candidates.service';
import * as FriendsPageActions from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import { ExplorePersonalMediaService } from './explore-personal-media.service';

function photo(
  id: string,
  ownerUid: string,
  publishedAt: number
): IPublicPhotoItem {
  return {
    id,
    ownerUid,
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    url: `https://example.test/${id}.webp`,
    createdAt: publishedAt,
    publishedAt,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
  } as IPublicPhotoItem;
}

describe('ExplorePersonalMediaService', () => {
  const viewerUid = 'viewer-1';
  const friendUids = Array.from(
    { length: 12 },
    (_, index) => `friend-${index + 1}`
  );
  const compatibleOwnerUids = Array.from(
    { length: 12 },
    (_, index) => `compatible-${index + 1}`
  );
  const firstOwnerBatch = [
    'friend-1',
    'friend-2',
    'friend-3',
    'friend-4',
    'friend-5',
    'friend-6',
    'friend-7',
    'friend-8',
    'compatible-1',
    'compatible-2',
    'compatible-3',
    'compatible-4',
  ];
  const secondOwnerBatch = [
    'friend-9',
    'friend-10',
    'friend-11',
    'friend-12',
    'compatible-5',
    'compatible-6',
    'compatible-7',
    'compatible-8',
    'compatible-9',
    'compatible-10',
    'compatible-11',
    'compatible-12',
  ];
  const photoCursor = {
    kind: 'PHOTO' as const,
    publishedAt: 100,
    documentPath: 'public_profiles/friend-1/public_photos/first-batch',
  };

  const ownerPageQueryMock = {
    loadPhotoPage$: vi.fn((request: any) => {
      if (request.cursor) {
        return of({
          items: [photo('first-batch-page-2', 'friend-2', 90)],
          nextCursor: null,
          hasMore: false,
          failed: false,
          loadedAt: Date.now(),
        });
      }

      if (request.ownerUids.includes('friend-1')) {
        return of({
          items: [photo('first-batch', 'friend-1', 110)],
          nextCursor: photoCursor,
          hasMore: true,
          failed: false,
          loadedAt: Date.now(),
        });
      }

      return of({
        items: [photo('second-batch', 'compatible-5', 105)],
        nextCursor: null,
        hasMore: false,
        failed: false,
        loadedAt: Date.now(),
      });
    }),
    loadVideoPage$: vi.fn(() =>
      of({
        items: [],
        nextCursor: null,
        hasMore: false,
        failed: false,
        loadedAt: Date.now(),
      })
    ),
  };

  const discoveryQueryMock = {
    getProfilesByUids$: vi.fn((uids: string[]) =>
      of(
        uids.map((uid) => ({
          uid,
          nickname: `Perfil ${uid}`,
        }))
      )
    ),
  };
  const compatibleCandidatesMock = {
    pool$: of({
      ownerUids: compatibleOwnerUids,
      hasMore: false,
      loadingInitial: false,
      loadingMore: false,
      refreshing: false,
      initialized: true,
      error: null,
    }),
    loadMore$: vi.fn(() => of(false)),
  };
  const globalErrorMock = { handleError: vi.fn() };
  const notificationMock = { showWarning: vi.fn() };

  let store: MockStore;
  let service: ExplorePersonalMediaService;

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          initialState: {
            friendsPages: {
              byUid: {
                [viewerUid]: {
                  items: friendUids.map((friendUid) => ({ friendUid })),
                  nextOrderValue: null,
                  reachedEnd: true,
                  loading: false,
                  error: null,
                },
              },
            },
          },
        }),
        {
          provide: AccessControlService,
          useValue: {
            authUid$: of(viewerUid),
            canRunApp$: of(true),
          },
        },
        {
          provide: CompatibleProfileCandidatesService,
          useValue: compatibleCandidatesMock,
        },
        {
          provide: PublicMediaOwnerPageQueryService,
          useValue: ownerPageQueryMock,
        },
        {
          provide: UserDiscoveryQueryService,
          useValue: discoveryQueryMock,
        },
        {
          provide: ErrorNotificationService,
          useValue: notificationMock,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: globalErrorMock,
        },
      ],
    });

    store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    service = TestBed.inject(ExplorePersonalMediaService);
  });

  it('solicita a primeira página de amigos pelo NgRx', () => {
    expect(store.dispatch).toHaveBeenCalledWith(
      FriendsPageActions.loadFriendsFirstPage({
        uid: viewerUid,
        pageSize: 18,
      })
    );
  });

  it('monta o primeiro lote com oito amigos e quatro compatíveis', async () => {
    const context = await firstValueFrom(service.context$);

    expect(context.friendUids).toEqual(friendUids);
    expect(context.compatibleOwnerUids).toEqual(compatibleOwnerUids);
    expect(ownerPageQueryMock.loadPhotoPage$).toHaveBeenCalledWith({
      ownerUids: firstOwnerBatch,
      pageSize: 12,
      cursor: null,
    });
    expect(ownerPageQueryMock.loadVideoPage$).toHaveBeenCalledWith({
      ownerUids: firstOwnerBatch,
      pageSize: 12,
      cursor: null,
    });
    expect(discoveryQueryMock.getProfilesByUids$).toHaveBeenCalledWith(
      firstOwnerBatch,
      { cacheTTL: 300_000 }
    );
    expect(context.personalPhotos.map((item) => item.id)).toEqual([
      'first-batch',
    ]);
    expect(context.personalPhotos[0].ownerNickname).toBe('Perfil friend-1');
    expect(context.hasMorePersonalMedia).toBe(true);
  });

  it('abre um novo lote sem reutilizar o cursor do lote anterior', async () => {
    await firstValueFrom(service.context$);

    const loaded = await firstValueFrom(service.loadMore$());
    const context = await firstValueFrom(service.context$);

    expect(loaded).toBe(true);
    expect(ownerPageQueryMock.loadPhotoPage$).toHaveBeenLastCalledWith({
      ownerUids: secondOwnerBatch,
      pageSize: 12,
      cursor: null,
    });
    expect(ownerPageQueryMock.loadVideoPage$).toHaveBeenLastCalledWith({
      ownerUids: secondOwnerBatch,
      pageSize: 12,
      cursor: null,
    });
    expect(context.personalPhotos.map((item) => item.id)).toEqual([
      'first-batch',
      'second-batch',
    ]);
    expect(context.hasMorePersonalMedia).toBe(true);
  });

  it('reutiliza o cursor somente dentro do lote que o originou', async () => {
    await firstValueFrom(service.context$);
    await firstValueFrom(service.loadMore$());

    const loaded = await firstValueFrom(service.loadMore$());
    const context = await firstValueFrom(service.context$);

    expect(loaded).toBe(true);
    expect(ownerPageQueryMock.loadPhotoPage$).toHaveBeenLastCalledWith({
      ownerUids: firstOwnerBatch,
      pageSize: 12,
      cursor: photoCursor,
    });
    expect(context.personalPhotos.map((item) => item.id)).toEqual([
      'first-batch',
      'second-batch',
      'first-batch-page-2',
    ]);
    expect(context.hasMorePersonalMedia).toBe(false);
    expect(context.loadingMorePersonalMedia).toBe(false);
    expect(compatibleCandidatesMock.loadMore$).not.toHaveBeenCalled();
  });
});

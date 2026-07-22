import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { UserDiscoveryQueryService } from 'src/app/core/services/data-handling/queries/user-discovery.query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import * as FriendsPageActions from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import { ExploreFeedService } from './explore-feed.service';
import { ExplorePersonalMediaService } from './explore-personal-media.service';

function photo(
  id: string,
  ownerUid: string,
  publishedAt: number
): IPublicPhotoItem {
  return {
    id,
    ownerUid,
    url: `https://example.test/${id}.webp`,
    createdAt: publishedAt,
    publishedAt,
    visibility: 'PUBLIC',
    orderIndex: 0,
  } as IPublicPhotoItem;
}

describe('ExplorePersonalMediaService', () => {
  const viewerUid = 'viewer-1';
  const mediaQueryMock = {
    getProfilePublicPhotos$: vi.fn((ownerUid: string) => {
      if (ownerUid === 'friend-1') {
        return of([
          photo('friend-1', ownerUid, 4),
          photo('friend-2', ownerUid, 3),
          photo('friend-3', ownerUid, 2),
          photo('friend-4', ownerUid, 1),
        ]);
      }

      return of([photo('compatible-1', ownerUid, 10)]);
    }),
  };
  const discoveryQueryMock = {
    getProfilesByUids$: vi.fn((uids: string[]) =>
      of(
        uids.map((uid) => ({
          uid,
          nickname: uid === 'friend-1' ? 'Amigo' : 'Compatível',
        }))
      )
    ),
  };
  const globalErrorMock = {
    handleError: vi.fn(),
  };

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
                  items: [
                    { friendUid: 'friend-1' },
                    { friendUid: 'friend-1' },
                  ],
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
          provide: ExploreFeedService,
          useValue: {
            compatibleProfiles$: of([
              { uid: 'compatible-1', nickname: 'Compatível' },
            ]),
          },
        },
        {
          provide: MediaPublicQueryService,
          useValue: mediaQueryMock,
        },
        {
          provide: UserDiscoveryQueryService,
          useValue: discoveryQueryMock,
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

  it('combina amigos e compatíveis sem duplicar autores', async () => {
    const context = await firstValueFrom(service.context$);

    expect(context.friendUids).toEqual(['friend-1']);
    expect(mediaQueryMock.getProfilePublicPhotos$).toHaveBeenCalledTimes(2);
    expect(mediaQueryMock.getProfilePublicPhotos$).toHaveBeenNthCalledWith(
      1,
      'friend-1'
    );
    expect(mediaQueryMock.getProfilePublicPhotos$).toHaveBeenNthCalledWith(
      2,
      'compatible-1'
    );
    expect(context.personalPhotos.map((item) => item.id)).toEqual([
      'compatible-1',
      'friend-1',
      'friend-2',
      'friend-3',
    ]);
    expect(context.personalPhotos.every((item) => item.ownerNickname)).toBe(true);
  });
});

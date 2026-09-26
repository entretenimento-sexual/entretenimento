import { firstValueFrom, of, throwError } from 'rxjs';
import { take } from 'rxjs/operators';
import { describe, expect, it, vi } from 'vitest';

import type {
  IPublicPhotoRankingCursor,
  IPublicPhotoRankingPage,
  TPublicPhotoRankingMode,
} from 'src/app/core/interfaces/media/i-public-photo-ranking';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { PublicPhotoDiscoveryFeedService } from './public-photo-discovery-feed.service';

function photo(index: number): IPublicPhotoItem {
  return {
    id: 'photo-' + index,
    ownerUid: 'owner-' + index,
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    createdAt: index + 1,
    publishedAt: index + 1,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    url: 'https://example.test/photo-' + index + '.jpg?token=temporary',
  } as IPublicPhotoItem;
}

function cursor(
  mode: TPublicPhotoRankingMode,
  id: string,
  boostedUntil = 0
): IPublicPhotoRankingCursor {
  return {
    mode,
    score: 10,
    publishedAt: 10,
    boostedUntil,
    documentPath: 'public_profiles/owner/public_photos/' + id,
  };
}

function page(
  mode: TPublicPhotoRankingMode,
  items: IPublicPhotoItem[],
  nextCursor: IPublicPhotoRankingCursor | null,
  hasMore: boolean
): IPublicPhotoRankingPage {
  return {
    mode,
    source: mode,
    items,
    nextCursor,
    hasMore,
    loadedAt: 1,
  };
}

function setup(options: {
  cached?: IPublicPhotoItem[];
  loadPage: (request: {
    mode: TPublicPhotoRankingMode;
    pageSize?: number;
    cursor?: IPublicPhotoRankingCursor | null;
  }) => IPublicPhotoRankingPage;
}) {
  const ranking = {
    loadPage$: vi.fn((request) => {
      try {
        return of(options.loadPage(request));
      } catch (error) {
        return throwError(() => error);
      }
    }),
  };
  const snapshots = {
    read$: vi.fn(() => of(options.cached ?? [])),
    write: vi.fn(),
  };
  const network = {
    reconnected$: of(),
    isOnlineSnapshot: vi.fn(() => true),
  };
  const activity = {
    track$: vi.fn((source) => source),
  };
  const errorNotifier = {
    showError: vi.fn(),
    showWarning: vi.fn(),
  };

  const service = new PublicPhotoDiscoveryFeedService(
    ranking as never,
    snapshots as never,
    network as never,
    activity as never,
    errorNotifier as never
  );

  return {
    service,
    ranking,
    snapshots,
    errorNotifier,
  };
}

describe('PublicPhotoDiscoveryFeedService', () => {
  it('entrega snapshot stale e revalida a primeira página sem polling', async () => {
    const cached = [photo(900)];
    const fresh = [photo(1), photo(2)];
    const next = cursor('top', 'cursor-1');
    const context = setup({
      cached,
      loadPage: ({ mode, cursor: requestCursor }) => {
        expect(mode).toBe('top');
        expect(requestCursor ?? null).toBeNull();
        return page('top', fresh, next, true);
      },
    });
    const emissions: Array<{
      ids: string[];
      stale: boolean;
      loading: boolean;
    }> = [];

    const subscription = context.service.connect$('top').subscribe((state) => {
      emissions.push({
        ids: state.items.map((item) => item.id),
        stale: state.stale,
        loading: state.loading,
      });
    });

    const finalState = await firstValueFrom(
      context.service.state$.pipe(take(1))
    );
    subscription.unsubscribe();

    expect(emissions).toContainEqual({
      ids: ['photo-900'],
      stale: true,
      loading: true,
    });
    expect(finalState.items.map((item) => item.id)).toEqual([
      'photo-1',
      'photo-2',
    ]);
    expect(finalState.stale).toBe(false);
    expect(finalState.hasMore).toBe(true);
    expect(context.ranking.loadPage$).toHaveBeenCalledTimes(1);
    expect(context.snapshots.write).toHaveBeenCalledWith(
      'top-photos',
      fresh
    );
  });

  it('pagina por cursor além de 60 itens sem reler o conjunto integral', async () => {
    const firstCursor = cursor('latest', 'cursor-1');
    const secondCursor = cursor('latest', 'cursor-2');
    const context = setup({
      loadPage: ({ mode, cursor: requestCursor }) => {
        const path = requestCursor?.documentPath ?? '';

        if (!path) {
          return page(
            mode,
            Array.from({ length: 24 }, (_, index) => photo(index)),
            firstCursor,
            true
          );
        }

        if (path.endsWith('cursor-1')) {
          return page(
            mode,
            Array.from({ length: 24 }, (_, index) => photo(index + 24)),
            secondCursor,
            true
          );
        }

        return page(
          mode,
          Array.from({ length: 24 }, (_, index) => photo(index + 48)),
          null,
          false
        );
      },
    });

    const subscription = context.service.connect$('latest').subscribe();
    await firstValueFrom(context.service.loadMore$());
    await firstValueFrom(context.service.loadMore$());
    const finalState = await firstValueFrom(
      context.service.state$.pipe(take(1))
    );
    subscription.unsubscribe();

    expect(finalState.items).toHaveLength(72);
    expect(finalState.hasMore).toBe(false);
    expect(context.ranking.loadPage$).toHaveBeenCalledTimes(3);
    expect(context.ranking.loadPage$.mock.calls[1]?.[0]?.cursor)
      .toEqual(firstCursor);
    expect(context.ranking.loadPage$.mock.calls[2]?.[0]?.cursor)
      .toEqual(secondCursor);
  });

  it('usa cursor BOOSTED e preserva itens quando a continuação falha', async () => {
    const boostedCursor = cursor(
      'boosted',
      'boosted-cursor',
      Date.now() + 60_000
    );
    let calls = 0;
    const context = setup({
      loadPage: ({ mode }) => {
        calls += 1;

        if (calls > 1) {
          throw new Error('temporary failure');
        }

        return page(mode, [photo(1)], boostedCursor, true);
      },
    });

    const subscription = context.service.connect$('boosted').subscribe();
    const loaded = await firstValueFrom(context.service.loadMore$());
    const finalState = await firstValueFrom(
      context.service.state$.pipe(take(1))
    );
    subscription.unsubscribe();

    expect(loaded).toBe(false);
    expect(finalState.items.map((item) => item.id)).toEqual(['photo-1']);
    expect(finalState.stale).toBe(true);
    expect(context.errorNotifier.showWarning).toHaveBeenCalledTimes(1);
    expect(context.ranking.loadPage$.mock.calls[1]?.[0]?.cursor)
      .toEqual(boostedCursor);
  });
});

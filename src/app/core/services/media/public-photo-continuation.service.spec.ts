import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type {
  IPublicPhotoRankingCursor,
  IPublicPhotoRankingPage,
  TPublicPhotoRankingMode,
} from 'src/app/core/interfaces/media/i-public-photo-ranking';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { buildPublicMediaIdentity } from 'src/app/core/utils/media/public-media-identity';
import { PublicPhotoContinuationService } from './public-photo-continuation.service';

function photo(id: string, ownerUid: string): IPublicPhotoItem {
  return {
    id,
    ownerUid,
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    url: `https://example.test/${id}.jpg?token=temporary`,
  } as IPublicPhotoItem;
}

function cursor(
  mode: TPublicPhotoRankingMode,
  id: string
): IPublicPhotoRankingCursor {
  return {
    mode,
    score: 0,
    publishedAt: 1,
    documentPath: `public_profiles/owner/public_photos/${id}`,
  };
}

function page(
  mode: TPublicPhotoRankingMode,
  items: IPublicPhotoItem[],
  options: { hasMore?: boolean; nextCursor?: IPublicPhotoRankingCursor | null } = {}
): IPublicPhotoRankingPage {
  return {
    mode,
    source: mode,
    items,
    hasMore: options.hasMore ?? false,
    nextCursor: options.nextCursor ?? null,
    loadedAt: 1,
  };
}

function buildService(input: {
  ranking: { loadPage$: ReturnType<typeof vi.fn> };
  personalizedItems?: IPublicPhotoItem[];
  personalizedError?: Error | null;
  recentViewedKeys?: readonly string[];
  recentViewsError?: Error | null;
}): PublicPhotoContinuationService {
  const mediaQuery = {
    getRecentPublicPhotosByOwners$: vi.fn(() =>
      input.personalizedError
        ? throwError(() => input.personalizedError)
        : of(input.personalizedItems ?? [])
    ),
  };
  const recentViews = {
    resolveRecentViewedKeys$: vi.fn(() =>
      input.recentViewsError
        ? throwError(() => input.recentViewsError)
        : of(input.recentViewedKeys ?? [])
    ),
  };

  return new PublicPhotoContinuationService(
    input.ranking as never,
    mediaQuery as never,
    recentViews as never
  );
}

describe('PublicPhotoContinuationService', () => {
  it('preserva continuação global removendo fotos já carregadas e do próprio usuário', async () => {
    const ranking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicPhotoRankingMode }) =>
        of(mode === 'top'
          ? page('top', [
            photo('existing', 'owner-1'),
            photo('self', 'viewer-1'),
            photo('top-1', 'owner-2'),
            photo('top-2', 'owner-3'),
          ])
          : page('latest', [
            photo('latest-1', 'owner-4'),
            photo('top-1', 'owner-2'),
          ]))
      ),
    };
    const service = buildService({ ranking });

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [photo('existing', 'owner-1')],
      excludeOwnerUid: 'viewer-1',
      source: 'discover',
      limit: 4,
    }));

    expect(result.items.map((item) => item.id)).toEqual([
      'top-1',
      'latest-1',
      'top-2',
    ]);
    expect(result.failed).toBe(false);
    expect(result.degraded).toBe(false);
    expect(result.exhausted).toBe(false);
  });

  it('mantém global dominante e alterna conexão/compatível no orçamento de um terço', async () => {
    const ranking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicPhotoRankingMode }) =>
        of(mode === 'latest'
          ? page('latest', [
            photo('global-1', 'global-a'),
            photo('global-2', 'global-b'),
            photo('global-3', 'global-c'),
          ])
          : page('top', [
            photo('global-4', 'global-d'),
            photo('global-5', 'global-e'),
          ]))
      ),
    };
    const service = buildService({
      ranking,
      personalizedItems: [
        photo('friend-1', 'friend-a'),
        photo('compatible-1', 'compatible-a'),
        photo('friend-2', 'friend-b'),
      ],
    });

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [],
      excludeOwnerUid: 'viewer-1',
      source: 'latest',
      limit: 6,
      continuationContext: {
        connectionOwnerUids: ['friend-a', 'friend-b'],
        compatibleOwnerUids: ['compatible-a'],
      },
    }));

    expect(result.items.map((item) => item.id)).toEqual([
      'friend-1',
      'global-1',
      'global-4',
      'compatible-1',
      'global-2',
      'global-5',
    ]);
  });

  it('prioriza não vistas dentro do bucket sem excluir vistas recentes', async () => {
    const ranking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicPhotoRankingMode }) =>
        of(page(mode, []))
      ),
    };
    const recentFriendKey = buildPublicMediaIdentity(
      'PHOTO',
      'friend-a',
      'friend-recent'
    );
    const service = buildService({
      ranking,
      personalizedItems: [
        photo('friend-recent', 'friend-a'),
        photo('friend-new', 'friend-a'),
      ],
      recentViewedKeys: [recentFriendKey],
    });

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [],
      excludeOwnerUid: 'viewer-1',
      continuationContext: {
        connectionOwnerUids: ['friend-a'],
        compatibleOwnerUids: [],
      },
    }));

    expect(result.items.map((item) => item.id)).toEqual([
      'friend-new',
      'friend-recent',
    ]);
    expect(result.items).toHaveLength(2);
  });

  it('prioriza latest quando a origem atual é latest', async () => {
    const ranking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicPhotoRankingMode }) =>
        of(page(mode, [photo(`${mode}-1`, `${mode}-owner`)]))
      ),
    };
    const service = buildService({ ranking });

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [],
      source: 'latest',
    }));

    expect(result.items.map((item) => item.id)).toEqual(['latest-1', 'top-1']);
  });

  it('consulta segunda página somente quando a primeira não tem candidato novo', async () => {
    const topNext = cursor('top', 'top-cursor');
    const calls: Array<{
      mode: TPublicPhotoRankingMode;
      cursor?: IPublicPhotoRankingCursor | null;
    }> = [];
    const ranking = {
      loadPage$: vi.fn((request: {
        mode: TPublicPhotoRankingMode;
        cursor?: IPublicPhotoRankingCursor | null;
      }) => {
        calls.push(request);

        if (request.mode === 'top' && !request.cursor) {
          return of(page('top', [photo('existing', 'owner-1')], {
            hasMore: true,
            nextCursor: topNext,
          }));
        }

        if (request.mode === 'top') {
          return of(page('top', [photo('fresh-top', 'owner-2')]));
        }

        return of(page('latest', []));
      }),
    };
    const service = buildService({ ranking });

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [photo('existing', 'owner-1')],
    }));

    expect(result.items.map((item) => item.id)).toEqual(['fresh-top']);
    expect(calls.filter((call) => call.mode === 'top')).toHaveLength(2);
  });

  it('continua com global quando novidade falha e marca degradação', async () => {
    const ranking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicPhotoRankingMode }) =>
        of(page(mode, mode === 'top'
          ? [photo('top-1', 'owner-a')]
          : [photo('latest-1', 'owner-b')]))
      ),
    };
    const service = buildService({
      ranking,
      recentViewsError: new Error('recent views unavailable'),
    });

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [],
      excludeOwnerUid: 'viewer-1',
    }));

    expect(result.items.map((item) => item.id)).toEqual([
      'top-1',
      'latest-1',
    ]);
    expect(result.failed).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.exhausted).toBe(false);
  });

  it('distingue esgotamento real de falha de fonte sem candidato', async () => {
    const exhaustedRanking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicPhotoRankingMode }) =>
        of(page(mode, []))
      ),
    };
    const failedRanking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicPhotoRankingMode }) =>
        mode === 'top'
          ? throwError(() => new Error('offline'))
          : of(page('latest', []))
      ),
    };

    const exhausted = await firstValueFrom(
      buildService({ ranking: exhaustedRanking })
        .loadContinuation$({ existingItems: [] })
    );
    const failed = await firstValueFrom(
      buildService({ ranking: failedRanking })
        .loadContinuation$({ existingItems: [] })
    );

    expect(exhausted).toMatchObject({
      items: [],
      exhausted: true,
      failed: false,
      degraded: false,
    });
    expect(failed).toMatchObject({
      items: [],
      exhausted: false,
      failed: true,
      degraded: true,
    });
  });
});

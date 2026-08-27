import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type {
  IPublicVideoRankingCursor,
  IPublicVideoRankingPage,
  TPublicVideoRankingMode,
} from 'src/app/core/interfaces/media/i-public-video-ranking';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { buildPublicMediaIdentity } from 'src/app/core/utils/media/public-media-identity';
import { PublicVideoContinuationService } from './public-video-continuation.service';

function video(id: string, ownerUid: string): IPublicVideoItem {
  return {
    id,
    ownerUid,
    mediaType: 'VIDEO',
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    url: null,
    posterUrl: `https://example.test/${id}.webp?token=temporary`,
  } as IPublicVideoItem;
}

function cursor(
  mode: TPublicVideoRankingMode,
  id: string
): IPublicVideoRankingCursor {
  return {
    mode,
    score: 0,
    uniqueViewersCount: 0,
    viewsCount: 0,
    publishedAt: 1,
    documentPath: `public_profiles/owner/public_videos/${id}`,
  };
}

function page(
  mode: TPublicVideoRankingMode,
  items: IPublicVideoItem[],
  options: { hasMore?: boolean; nextCursor?: IPublicVideoRankingCursor | null } = {}
): IPublicVideoRankingPage {
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
  personalizedItems?: IPublicVideoItem[];
  personalizedError?: Error | null;
  recentViewedKeys?: readonly string[];
  recentViewsError?: Error | null;
}): PublicVideoContinuationService {
  const mediaQuery = {
    getRecentPublicVideoPreviewsByOwners$: vi.fn(() =>
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

  return new PublicVideoContinuationService(
    input.ranking as never,
    mediaQuery as never,
    recentViews as never
  );
}

describe('PublicVideoContinuationService', () => {
  it('preserva continuação global removendo vídeos já carregados e o próprio usuário', async () => {
    const ranking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicVideoRankingMode }) =>
        of(mode === 'top'
          ? page('top', [
            video('existing', 'owner-1'),
            video('self', 'viewer-1'),
            video('top-1', 'owner-2'),
            video('top-2', 'owner-3'),
          ])
          : page('latest', [
            video('latest-1', 'owner-4'),
            video('top-1', 'owner-2'),
          ]))
      ),
    };
    const service = buildService({ ranking });

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [video('existing', 'owner-1')],
      excludeOwnerUid: 'viewer-1',
      source: 'discover',
      limit: 4,
    }));

    expect(result.items.map((item) => item.id)).toEqual([
      'top-1',
      'latest-1',
      'top-2',
    ]);
    expect(result.items.every((item) => item.url === null)).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.degraded).toBe(false);
    expect(result.exhausted).toBe(false);
  });

  it('mantém global dominante e alterna conexão/compatível no orçamento de um terço', async () => {
    const ranking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicVideoRankingMode }) =>
        of(mode === 'latest'
          ? page('latest', [
            video('global-1', 'global-a'),
            video('global-2', 'global-b'),
            video('global-3', 'global-c'),
          ])
          : page('top', [
            video('global-4', 'global-d'),
            video('global-5', 'global-e'),
          ]))
      ),
    };
    const service = buildService({
      ranking,
      personalizedItems: [
        video('friend-1', 'friend-a'),
        video('compatible-1', 'compatible-a'),
        video('friend-2', 'friend-b'),
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

  it('prioriza não vistos dentro do mesmo bucket sem remover os vistos recentes', async () => {
    const ranking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicVideoRankingMode }) =>
        of(page(mode, []))
      ),
    };
    const recentFriendKey = buildPublicMediaIdentity(
      'VIDEO',
      'friend-a',
      'friend-recent'
    );
    const service = buildService({
      ranking,
      personalizedItems: [
        video('friend-recent', 'friend-a'),
        video('friend-new', 'friend-a'),
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
      loadPage$: vi.fn(({ mode }: { mode: TPublicVideoRankingMode }) =>
        of(page(mode, [video(`${mode}-1`, `${mode}-owner`)]))
      ),
    };
    const service = buildService({ ranking });

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [],
      source: 'latest',
    }));

    expect(result.items.map((item) => item.id)).toEqual(['latest-1', 'top-1']);
  });

  it('consulta uma segunda página somente quando a primeira não trouxe candidato novo', async () => {
    const topNext = cursor('top', 'top-cursor');
    const calls: Array<{ mode: TPublicVideoRankingMode; cursor?: IPublicVideoRankingCursor | null }> = [];
    const ranking = {
      loadPage$: vi.fn((request: {
        mode: TPublicVideoRankingMode;
        cursor?: IPublicVideoRankingCursor | null;
      }) => {
        calls.push(request);

        if (request.mode === 'top' && !request.cursor) {
          return of(page('top', [video('existing', 'owner-1')], {
            hasMore: true,
            nextCursor: topNext,
          }));
        }

        if (request.mode === 'top') {
          return of(page('top', [video('fresh-top', 'owner-2')]));
        }

        return of(page('latest', []));
      }),
    };
    const service = buildService({ ranking });

    const result = await firstValueFrom(service.loadContinuation$({
      existingItems: [video('existing', 'owner-1')],
    }));

    expect(result.items.map((item) => item.id)).toEqual(['fresh-top']);
    expect(calls.filter((call) => call.mode === 'top')).toHaveLength(2);
  });

  it('continua com global quando novidade falha e marca degradação sem falha fatal', async () => {
    const ranking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicVideoRankingMode }) =>
        of(page(mode, mode === 'top'
          ? [video('top-1', 'owner-a')]
          : [video('latest-1', 'owner-b')]))
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

  it('distingue esgotamento real de falha de fontes quando não há candidato', async () => {
    const exhaustedRanking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicVideoRankingMode }) =>
        of(page(mode, []))
      ),
    };
    const failedRanking = {
      loadPage$: vi.fn(({ mode }: { mode: TPublicVideoRankingMode }) =>
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

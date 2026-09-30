import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SocialExploreTimelineFacade } from './social-explore-timeline.facade';

describe('SocialExploreTimelineFacade', () => {
  function setup(input?: {
    hasMorePersonalMedia?: boolean;
    personalVideos?: any[];
    friendUids?: string[];
    compatibleProfiles?: any[];
    compatibleOwnerUids?: string[];
  }) {
    const exploreVm$ = new BehaviorSubject<any>({
      boostedPhotos: [],
      mostViewedPhotos: [],
      topPhotos: [],
      latestPhotos: [],
      videoHighlights: [],
      videoHighlightsStatus: 'empty',
      sections: [],
      compatibleProfiles: input?.compatibleProfiles ?? [],
      compatibleOwnerUids: input?.compatibleOwnerUids ?? [],
      totalItems: 0,
      hasAnyContent: false,
    });

    const personalContext$ = new BehaviorSubject<any>({
      friendUids: input?.friendUids ?? ['friend-1'],
      personalPhotos: [],
      personalVideos: input?.personalVideos ?? [],
      hasMorePersonalMedia: input?.hasMorePersonalMedia ?? false,
      loadingInitialPersonalMedia: false,
      loadingMorePersonalMedia: false,
      personalMediaLoadFailed: false,
    });

    const compatibleProfiles$ = new BehaviorSubject<any[]>(
      input?.compatibleProfiles ?? [{ uid: 'compatible-1' }]
    );

    const loadMore$ = vi.fn(() => of(true));
    const retryVideoHighlights = vi.fn();
    const watchActiveStatusesForUserRegion$ = vi.fn(() => of([]));

    const facade = new SocialExploreTimelineFacade(
      {
        vm$: exploreVm$.asObservable(),
        retryVideoHighlights,
      } as any,
      {
        context$: personalContext$.asObservable(),
        loadMore$,
      } as any,
      {
        profiles$: compatibleProfiles$.asObservable(),
      } as any,
      {
        readyUid$: of('viewer'),
      } as any,
      {
        watchActiveStatusesForUserRegion$,
      } as any
    );

    return {
      facade,
      exploreVm$,
      personalContext$,
      compatibleProfiles$,
      loadMore$,
      retryVideoHighlights,
      watchActiveStatusesForUserRegion$,
    };
  }

  it('filtra momentos pelos amigos e compatíveis antes da consulta regional', async () => {
    const { facade, watchActiveStatusesForUserRegion$ } = setup({
      friendUids: ['friend-1', 'viewer'],
      compatibleProfiles: [
        { uid: 'compatible-1' },
        { uid: 'compatible-2' },
      ],
      compatibleOwnerUids: ['compatible-2', 'compatible-3'],
    });

    await firstValueFrom(facade.feedWindow$);

    expect(watchActiveStatusesForUserRegion$).toHaveBeenCalledWith(
      'viewer',
      {
        limit: 24,
        ownerUids: [
          'friend-1',
          'compatible-1',
          'compatible-2',
          'compatible-3',
        ],
      }
    );
  });

  it('busca nova página quando a janela local acabou e o backend ainda tem mídia', async () => {
    const { facade, loadMore$ } = setup({
      hasMorePersonalMedia: true,
    });

    await firstValueFrom(facade.loadMore$());

    expect(loadMore$).toHaveBeenCalledTimes(1);
  });

  it('não busca backend quando não existe mais conteúdo', async () => {
    const { facade, loadMore$ } = setup({
      hasMorePersonalMedia: false,
    });

    const values: unknown[] = [];
    facade.loadMore$().subscribe((value) => values.push(value));

    expect(loadMore$).not.toHaveBeenCalled();
    expect(values).toEqual([]);
  });

  it('delega retry de vídeos à facade canônica do Explore', () => {
    const { facade, retryVideoHighlights } = setup();

    facade.retryVideoHighlights();

    expect(retryVideoHighlights).toHaveBeenCalledTimes(1);
  });
});

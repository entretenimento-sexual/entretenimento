// src/app/store/reducers/reducers.discovery/discovery-feed.reducer.spec.ts

import { describe, expect, it } from 'vitest';

import * as DiscoveryActions from '../../actions/actions.discovery/discovery-feed.actions';
import { buildDiscoveryFeedQueryKey } from 'src/app/dashboard/discovery/models/discovery-feed-page.model';
import { discoveryFeedReducer } from './discovery-feed.reducer';
import { initialDiscoveryFeedState } from '../../states/states.discovery/discovery-feed.state';

const request = {
  viewerUid: 'viewer-1',
  mode: 'all' as const,
  pageSize: 24,
};

const queryKey = buildDiscoveryFeedQueryKey(request);

const firstProfile = {
  uid: 'profile-1',
  nickname: 'Perfil 1',
  updatedAt: 1_700_000_000_000,
};

const secondProfile = {
  uid: 'profile-2',
  nickname: 'Perfil 2',
  updatedAt: 1_699_000_000_000,
};

describe('discoveryFeedReducer', () => {
  it('deve iniciar o carregamento da primeira página', () => {
    const state = discoveryFeedReducer(
      initialDiscoveryFeedState,
      DiscoveryActions.loadDiscoveryFirstPage({ request })
    );

    expect(state.byQuery[queryKey]?.loadingInitial).toBe(true);
    expect(state.byQuery[queryKey]?.items).toEqual([]);
  });

  it('deve exibir cache e manter revalidação ativa', () => {
    const loading = discoveryFeedReducer(
      initialDiscoveryFeedState,
      DiscoveryActions.loadDiscoveryFirstPage({ request })
    );

    const state = discoveryFeedReducer(
      loading,
      DiscoveryActions.loadDiscoveryPageSuccess({
        request,
        append: false,
        page: {
          items: [firstProfile],
          nextCursor: {
            updatedAtMs: 1_700_000_000_000,
            uid: 'profile-1',
          },
          reachedEnd: false,
          source: 'cache',
          fetchedAt: 1_700_000_100_000,
        },
      })
    );

    expect(state.byQuery[queryKey]?.items).toEqual([firstProfile]);
    expect(state.byQuery[queryKey]?.loadingInitial).toBe(false);
    expect(state.byQuery[queryKey]?.refreshing).toBe(true);
    expect(state.byQuery[queryKey]?.lastLoadedAt).toBeNull();
  });

  it('deve encerrar revalidação quando o servidor responder', () => {
    const state = discoveryFeedReducer(
      initialDiscoveryFeedState,
      DiscoveryActions.loadDiscoveryPageSuccess({
        request,
        append: false,
        page: {
          items: [firstProfile],
          nextCursor: null,
          reachedEnd: true,
          source: 'server',
          fetchedAt: 1_700_000_100_000,
        },
      })
    );

    expect(state.byQuery[queryKey]?.refreshing).toBe(false);
    expect(state.byQuery[queryKey]?.reachedEnd).toBe(true);
    expect(state.byQuery[queryKey]?.lastLoadedAt).toBe(1_700_000_100_000);
  });

  it('deve anexar nova página sem duplicar uid e atualizar item existente', () => {
    const firstState = discoveryFeedReducer(
      initialDiscoveryFeedState,
      DiscoveryActions.loadDiscoveryPageSuccess({
        request,
        append: false,
        page: {
          items: [firstProfile],
          nextCursor: {
            updatedAtMs: 1_700_000_000_000,
            uid: 'profile-1',
          },
          reachedEnd: false,
          source: 'server',
          fetchedAt: 1,
        },
      })
    );

    const state = discoveryFeedReducer(
      firstState,
      DiscoveryActions.loadDiscoveryPageSuccess({
        request,
        append: true,
        page: {
          items: [
            { ...firstProfile, nickname: 'Perfil 1 atualizado' },
            secondProfile,
          ],
          nextCursor: null,
          reachedEnd: true,
          source: 'server',
          fetchedAt: 2,
        },
      })
    );

    expect(state.byQuery[queryKey]?.items).toHaveLength(2);
    expect(state.byQuery[queryKey]?.items[0]?.nickname).toBe(
      'Perfil 1 atualizado'
    );
    expect(state.byQuery[queryKey]?.items[1]?.uid).toBe('profile-2');
  });

  it('deve preservar itens carregados quando uma atualização falhar', () => {
    const populated = discoveryFeedReducer(
      initialDiscoveryFeedState,
      DiscoveryActions.loadDiscoveryPageSuccess({
        request,
        append: false,
        page: {
          items: [firstProfile],
          nextCursor: null,
          reachedEnd: true,
          source: 'server',
          fetchedAt: 1,
        },
      })
    );

    const state = discoveryFeedReducer(
      populated,
      DiscoveryActions.loadDiscoveryPageFailure({
        request,
        error: 'offline',
      })
    );

    expect(state.byQuery[queryKey]?.items).toEqual([firstProfile]);
    expect(state.byQuery[queryKey]?.error).toBe('offline');
    expect(state.byQuery[queryKey]?.loadingMore).toBe(false);
  });
});

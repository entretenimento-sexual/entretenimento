import { describe, expect, it } from 'vitest';
import type { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';
import {
  COMMUNITY_DISCOVERY_CACHE_HARD_TTL_MS,
  COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES,
  buildCommunityDiscoveryCacheKey,
  buildCommunityDiscoveryCacheQuery,
} from 'src/app/community/discovery/community-discovery-cache.model';
import * as Actions from '../../actions/actions.discovery/community-discovery-cache.actions';
import { initialCommunityDiscoveryCacheState } from '../../states/states.discovery/community-discovery-cache.state';
import { communityDiscoveryCacheReducer } from './community-discovery-cache.reducer';

function card(id: string): CommunityPreviewCard {
  return {
    communityId: id,
    name: `Comunidade ${id}`,
    slug: `comunidade-${id}`,
    description: null,
    source: { type: 'community', id },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 1, postCount: 0, mediaCount: 0 },
    access: { join: 'approval', minimumRole: null, requiresActiveSubscription: false },
    tags: [],
  };
}

describe('communityDiscoveryCacheReducer', () => {
  const query = buildCommunityDiscoveryCacheQuery('viewer-1', {
    sourceType: 'community', discoveryMode: 'explore', tagId: null, pageSize: 12,
  })!;

  it('acumula paginas sem duplicar communityId nem renovar a idade da primeira pagina', () => {
    const first = communityDiscoveryCacheReducer(initialCommunityDiscoveryCacheState,
      Actions.storeCommunityDiscoveryPage({
        query,
        page: { items: [card('a'), card('b')], nextCursor: 'b', generatedAt: 10 },
        append: false,
        storedAt: 100,
      }));
    const appended = communityDiscoveryCacheReducer(first,
      Actions.storeCommunityDiscoveryPage({
        query,
        page: { items: [card('b'), card('c')], nextCursor: null, generatedAt: 20 },
        append: true,
        storedAt: 200,
      }));
    const slice = Object.values(appended.byQuery)[0]!;
    expect(slice.items.map((item) => item.communityId)).toEqual(['a', 'b', 'c']);
    expect(slice.lastLoadedAt).toBe(100);
    expect(slice.lastAccessedAt).toBe(200);
    expect(slice.invalidated).toBe(false);
  });

  it('limpa snapshots quando o viewer muda', () => {
    const populated = communityDiscoveryCacheReducer(initialCommunityDiscoveryCacheState,
      Actions.storeCommunityDiscoveryPage({
        query,
        page: { items: [card('a')], nextCursor: null, generatedAt: 10 },
        append: false,
        storedAt: 100,
      }));
    const switched = communityDiscoveryCacheReducer(populated,
      Actions.activateCommunityDiscoveryViewer({ viewerUid: 'viewer-2' }));
    expect(switched.activeViewerUid).toBe('viewer-2');
    expect(switched.byQuery).toEqual({});
  });

  it('invalida sem destruir a lista nem perder a idade real', () => {
    const populated = communityDiscoveryCacheReducer(initialCommunityDiscoveryCacheState,
      Actions.storeCommunityDiscoveryPage({
        query,
        page: { items: [card('a')], nextCursor: null, generatedAt: 10 },
        append: false,
        storedAt: 100,
      }));
    const invalidated = communityDiscoveryCacheReducer(populated,
      Actions.invalidateCommunityDiscoveryViewer({ viewerUid: 'viewer-1' }));
    const slice = Object.values(invalidated.byQuery)[0]!;
    expect(slice.items).toHaveLength(1);
    expect(slice.lastLoadedAt).toBe(100);
    expect(slice.lastAccessedAt).toBe(100);
    expect(slice.invalidated).toBe(true);
  });

  it('descarta um snapshot no hard ttl mesmo depois de invalidado', () => {
    const populated = communityDiscoveryCacheReducer(initialCommunityDiscoveryCacheState,
      Actions.storeCommunityDiscoveryPage({
        query,
        page: { items: [card('a')], nextCursor: null, generatedAt: 10 },
        append: false,
        storedAt: 100,
      }));
    const invalidated = communityDiscoveryCacheReducer(populated,
      Actions.invalidateCommunityDiscoveryViewer({ viewerUid: 'viewer-1' }));
    const expired = communityDiscoveryCacheReducer(invalidated,
      Actions.touchCommunityDiscoveryQuery({
        query,
        accessedAt: 100 + COMMUNITY_DISCOVERY_CACHE_HARD_TTL_MS,
      }));

    expect(expired.byQuery[buildCommunityDiscoveryCacheKey(query)]).toBeUndefined();
  });

  it('limita consultas pelo acesso mais recente usando lru', () => {
    let state = initialCommunityDiscoveryCacheState;
    const queries = Array.from(
      { length: COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES + 1 },
      (_, index) => buildCommunityDiscoveryCacheQuery('viewer-1', {
        sourceType: 'community',
        discoveryMode: 'explore',
        tagId: null,
        pageSize: 6 + index,
      })!
    );

    queries.forEach((currentQuery, index) => {
      state = communityDiscoveryCacheReducer(state,
        Actions.storeCommunityDiscoveryPage({
          query: currentQuery,
          page: {
            items: [card(`community-${index}`)],
            nextCursor: null,
            generatedAt: index + 1,
          },
          append: false,
          storedAt: 1_000 + index,
        }));
    });

    expect(Object.keys(state.byQuery)).toHaveLength(
      COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES
    );
    expect(
      state.byQuery[buildCommunityDiscoveryCacheKey(queries[0])]
    ).toBeUndefined();
    expect(
      state.byQuery[buildCommunityDiscoveryCacheKey(queries.at(-1)!)]
    ).toBeDefined();
  });

  it('nao cria snapshot truncado ao receber append sem primeira pagina valida', () => {
    const appendedOnly = communityDiscoveryCacheReducer(
      initialCommunityDiscoveryCacheState,
      Actions.storeCommunityDiscoveryPage({
        query,
        page: { items: [card('page-2')], nextCursor: null, generatedAt: 20 },
        append: true,
        storedAt: 200,
      })
    );

    expect(appendedOnly.byQuery).toEqual({});
  });
});

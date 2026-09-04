import { describe, expect, it } from 'vitest';
import type {
  CommunityPreviewCard,
  CommunityPreviewSourceType,
} from 'src/app/community/data-access/community-preview.model';
import {
  COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES,
  buildCommunityDiscoveryCacheQuery,
} from 'src/app/community/discovery/community-discovery-cache.model';
import * as Actions from '../../actions/actions.discovery/community-discovery-cache.actions';
import { initialCommunityDiscoveryCacheState } from '../../states/states.discovery/community-discovery-cache.state';
import { communityDiscoveryCacheReducer } from './community-discovery-cache.reducer';

function card(
  id: string,
  sourceType: CommunityPreviewSourceType = 'community'
): CommunityPreviewCard {
  return {
    communityId: id,
    name: `Comunidade ${id}`,
    slug: `comunidade-${id}`,
    description: null,
    source: { type: sourceType, id },
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

  it('acumula paginas sem duplicar communityId', () => {
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
    expect(slice.lastLoadedAt).toBe(200);
    expect(slice.query).toEqual(query);
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

  it('invalida todo o viewer sem destruir as listas quando não há escopo', () => {
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
    expect(slice.lastLoadedAt).toBe(0);
  });

  it('invalida apenas o tipo de origem solicitado', () => {
    const venueQuery = buildCommunityDiscoveryCacheQuery('viewer-1', {
      sourceType: 'venue', discoveryMode: 'explore', tagId: null, pageSize: 12,
    })!;
    const withCommunity = communityDiscoveryCacheReducer(
      initialCommunityDiscoveryCacheState,
      Actions.storeCommunityDiscoveryPage({
        query,
        page: { items: [card('community-a')], nextCursor: null, generatedAt: 10 },
        append: false,
        storedAt: 100,
      })
    );
    const populated = communityDiscoveryCacheReducer(
      withCommunity,
      Actions.storeCommunityDiscoveryPage({
        query: venueQuery,
        page: { items: [card('venue-a', 'venue')], nextCursor: null, generatedAt: 20 },
        append: false,
        storedAt: 200,
      })
    );

    const invalidated = communityDiscoveryCacheReducer(
      populated,
      Actions.invalidateCommunityDiscoveryViewer({
        viewerUid: 'viewer-1',
        sourceType: 'community',
      })
    );
    const slices = Object.values(invalidated.byQuery);

    expect(
      slices.find((slice) => slice.query.sourceType === 'community')?.lastLoadedAt
    ).toBe(0);
    expect(
      slices.find((slice) => slice.query.sourceType === 'venue')?.lastLoadedAt
    ).toBe(200);
  });

  it('invalida apenas consultas que já contêm a Comunidade solicitada', () => {
    const secondQuery = buildCommunityDiscoveryCacheQuery('viewer-1', {
      sourceType: 'community', discoveryMode: 'explore', tagId: null, pageSize: 24,
    })!;
    const first = communityDiscoveryCacheReducer(
      initialCommunityDiscoveryCacheState,
      Actions.storeCommunityDiscoveryPage({
        query,
        page: { items: [card('a')], nextCursor: null, generatedAt: 10 },
        append: false,
        storedAt: 100,
      })
    );
    const populated = communityDiscoveryCacheReducer(
      first,
      Actions.storeCommunityDiscoveryPage({
        query: secondQuery,
        page: { items: [card('b')], nextCursor: null, generatedAt: 20 },
        append: false,
        storedAt: 200,
      })
    );

    const invalidated = communityDiscoveryCacheReducer(
      populated,
      Actions.invalidateCommunityDiscoveryViewer({
        viewerUid: 'viewer-1',
        sourceType: 'community',
        communityId: 'a',
      })
    );
    const slices = Object.values(invalidated.byQuery);

    expect(
      slices.find((slice) => slice.query.pageSize === 12)?.lastLoadedAt
    ).toBe(0);
    expect(
      slices.find((slice) => slice.query.pageSize === 24)?.lastLoadedAt
    ).toBe(200);
  });

  it('limita consultas por viewer e remove primeiro a menos recente', () => {
    let state = initialCommunityDiscoveryCacheState;

    for (let index = 0; index <= COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES; index += 1) {
      const cacheQuery = buildCommunityDiscoveryCacheQuery('viewer-1', {
        sourceType: 'community',
        discoveryMode: 'explore',
        tagId: `intent:cache_${index}`,
        pageSize: 12,
      })!;

      state = communityDiscoveryCacheReducer(
        state,
        Actions.storeCommunityDiscoveryPage({
          query: cacheQuery,
          page: {
            items: [card(`community-${index}`)],
            nextCursor: null,
            generatedAt: 100 + index,
          },
          append: false,
          storedAt: 100 + index,
        })
      );
    }

    const slices = Object.values(state.byQuery);
    expect(slices).toHaveLength(COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES);
    expect(
      slices.some((slice) => slice.query.tagId === 'intent:cache_0')
    ).toBe(false);
    expect(
      slices.some(
        (slice) =>
          slice.query.tagId
          === `intent:cache_${COMMUNITY_DISCOVERY_CACHE_MAX_QUERIES}`
      )
    ).toBe(true);
  });
});

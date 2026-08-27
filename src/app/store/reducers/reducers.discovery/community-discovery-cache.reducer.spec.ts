import { describe, expect, it } from 'vitest';
import type { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';
import { buildCommunityDiscoveryCacheQuery } from 'src/app/community/discovery/community-discovery-cache.model';
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

  it('invalida sem destruir a lista', () => {
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
});

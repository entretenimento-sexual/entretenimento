import { describe, expect, it } from 'vitest';

import type { CommunityFeedItem } from 'src/app/community/data-access/community-feed.model';
import {
  COMMUNITY_FEED_CACHE_HARD_TTL_MS,
  COMMUNITY_FEED_CACHE_MAX_SCOPES,
  buildCommunityFeedCacheKey,
  buildCommunityFeedCacheQuery,
} from 'src/app/community/feed/community-feed-cache.model';

import * as CommunityFeedCacheActions from '../../actions/actions.community/community-feed-cache.actions';
import { initialCommunityFeedCacheState } from '../../states/states.community/community-feed-cache.state';
import { communityFeedCacheReducer } from './community-feed-cache.reducer';

const NOW = 1_800_000_000_000;

function item(postId: string): CommunityFeedItem {
  return {
    postId,
    kind: 'text',
    author: { label: 'Participante', avatarUrl: null },
    text: `Mensagem ${postId}`,
    image: null,
    replyTo: null,
    metrics: { commentCount: 0, reactionCount: 0 },
    capabilities: {
      canDeleteOwn: false,
      canModerate: false,
      canReport: true,
      canReact: true,
      viewerReacted: false,
      canViewComments: true,
      canComment: true,
    },
    publishedAt: NOW,
  };
}

function query(viewerUid: string, communityId: string) {
  return buildCommunityFeedCacheQuery(viewerUid, communityId, 'feed')!;
}

function storeFirstPage(
  state = initialCommunityFeedCacheState,
  viewerUid = 'user-1',
  communityId = 'community-1',
  occurredAt = NOW
) {
  const scope = query(viewerUid, communityId);
  return communityFeedCacheReducer(state, CommunityFeedCacheActions.applyCommunityFeedEvent({
    query: scope,
    event: {
      type: 'success',
      request: { cursor: null, append: false, preserve: true },
      page: {
        items: [item(`${communityId}-post`)],
        nextCursor: 'next-page',
        generatedAt: occurredAt,
      },
    },
    occurredAt,
  }));
}

describe('communityFeedCacheReducer', () => {
  it('limpa snapshots quando o viewer muda', () => {
    const populated = storeFirstPage();
    const switched = communityFeedCacheReducer(
      populated,
      CommunityFeedCacheActions.activateCommunityFeedViewer({ viewerUid: 'user-2' })
    );

    expect(switched.activeViewerUid).toBe('user-2');
    expect(switched.byScope).toEqual({});
  });

  it('reutiliza o reducer canônico de timeline para realtime', () => {
    const scope = query('user-1', 'community-1');
    const populated = storeFirstPage();
    const realtime = communityFeedCacheReducer(
      populated,
      CommunityFeedCacheActions.applyCommunityFeedEvent({
        query: scope,
        event: {
          type: 'realtime',
          upserts: [item('post-realtime')],
          metricPatches: [],
          removedIds: [],
        },
        occurredAt: NOW + 1_000,
      })
    );
    const slice = realtime.byScope[buildCommunityFeedCacheKey(scope)];

    expect(slice.state.items.map((entry) => entry.postId)).toContain('post-realtime');
    expect(slice.lastLoadedAt).toBe(NOW);
  });

  it('paginação não renova a idade da primeira página', () => {
    const scope = query('user-1', 'community-1');
    const populated = storeFirstPage();
    const paginated = communityFeedCacheReducer(
      populated,
      CommunityFeedCacheActions.applyCommunityFeedEvent({
        query: scope,
        event: {
          type: 'success',
          request: { cursor: 'next-page', append: true },
          page: {
            items: [item('older-post')],
            nextCursor: null,
            generatedAt: NOW + 60_000,
          },
        },
        occurredAt: NOW + 60_000,
      })
    );

    expect(paginated.byScope[buildCommunityFeedCacheKey(scope)].lastLoadedAt).toBe(NOW);
  });

  it('hard expiry descarta o escopo inteiro antes de reutilizar mídia antiga', () => {
    const scope = query('user-1', 'community-1');
    const populated = storeFirstPage();
    const touched = communityFeedCacheReducer(
      populated,
      CommunityFeedCacheActions.touchCommunityFeedScope({
        query: scope,
        accessedAt: NOW + COMMUNITY_FEED_CACHE_HARD_TTL_MS,
      })
    );
    const slice = touched.byScope[buildCommunityFeedCacheKey(scope)];

    expect(slice.state.items).toEqual([]);
    expect(slice.lastLoadedAt).toBe(0);
  });

  it('limita o cache aos escopos mais recentemente acessados', () => {
    let state = initialCommunityFeedCacheState;

    for (let index = 0; index < COMMUNITY_FEED_CACHE_MAX_SCOPES + 2; index += 1) {
      state = storeFirstPage(
        state,
        'user-1',
        `community-${index}`,
        NOW + index
      );
    }

    expect(Object.keys(state.byScope)).toHaveLength(COMMUNITY_FEED_CACHE_MAX_SCOPES);
    expect(
      state.byScope[buildCommunityFeedCacheKey(query('user-1', 'community-0'))]
    ).toBeUndefined();
    expect(
      state.byScope[buildCommunityFeedCacheKey(query('user-1', 'community-7'))]
    ).toBeDefined();
  });
});

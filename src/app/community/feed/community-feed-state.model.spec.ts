import { describe, expect, it } from 'vitest';

import type { CommunityFeedItem } from '../data-access/community-feed.model';
import {
  INITIAL_COMMUNITY_FEED_STATE,
  reduceCommunityFeedState,
} from './community-feed-state.model';

function item(postId: string, publishedAt: number): CommunityFeedItem {
  return {
    postId,
    kind: 'text',
    author: { label: 'Participante', avatarUrl: null },
    text: postId,
    image: null,
    replyTo: null,
    metrics: { commentCount: 0, reactionCount: 0 },
    capabilities: {
      canDeleteOwn: false,
      canModerate: false,
      canReport: false,
      canReact: false,
      viewerReacted: false,
      canViewComments: false,
      canComment: false,
    },
    publishedAt,
  };
}

describe('community feed pagination state', () => {
  it('mantém paginação carregando quando realtime chega no meio da busca', () => {
    const ready = reduceCommunityFeedState(INITIAL_COMMUNITY_FEED_STATE, {
      type: 'success',
      request: { cursor: null, append: false },
      page: {
        items: [item('post-10', 10_000)],
        nextCursor: 'cursor-10',
        generatedAt: 10_000,
      },
    });
    const loadingMore = reduceCommunityFeedState(ready, {
      type: 'loading',
      request: { cursor: 'cursor-10', append: true },
    });

    const afterRealtime = reduceCommunityFeedState(loadingMore, {
      type: 'realtime',
      upserts: [item('post-11', 11_000)],
      metricPatches: [],
      removedIds: [],
    });

    expect(afterRealtime.loadingMore).toBe(true);
    expect(afterRealtime.loadMoreError).toBe(false);
    expect(afterRealtime.nextCursor).toBe('cursor-10');
    expect(afterRealtime.items.map((entry) => entry.postId)).toEqual([
      'post-11',
      'post-10',
    ]);
  });

  it('acumula somente a página pedida, sem duplicar itens já visíveis', () => {
    const ready = reduceCommunityFeedState(INITIAL_COMMUNITY_FEED_STATE, {
      type: 'success',
      request: { cursor: null, append: false },
      page: {
        items: [item('post-10', 10_000), item('post-9', 9_000)],
        nextCursor: 'cursor-9',
        generatedAt: 10_000,
      },
    });

    const appended = reduceCommunityFeedState(ready, {
      type: 'success',
      request: { cursor: 'cursor-9', append: true },
      page: {
        items: [item('post-9', 9_000), item('post-8', 8_000)],
        nextCursor: 'cursor-8',
        generatedAt: 11_000,
      },
    });

    expect(appended.loadingMore).toBe(false);
    expect(appended.loadMoreError).toBe(false);
    expect(appended.nextCursor).toBe('cursor-8');
    expect(appended.items.map((entry) => entry.postId)).toEqual([
      'post-10',
      'post-9',
      'post-8',
    ]);
  });

  it('preserva histórico, cursor e feedback para retry quando página adicional falha', () => {
    const ready = reduceCommunityFeedState(INITIAL_COMMUNITY_FEED_STATE, {
      type: 'success',
      request: { cursor: null, append: false },
      page: {
        items: [item('post-10', 10_000), item('post-9', 9_000)],
        nextCursor: 'cursor-9',
        generatedAt: 10_000,
      },
    });
    const loadingMore = reduceCommunityFeedState(ready, {
      type: 'loading',
      request: { cursor: 'cursor-9', append: true },
    });

    const failed = reduceCommunityFeedState(loadingMore, {
      type: 'error',
      request: { cursor: 'cursor-9', append: true },
    });

    expect(failed.status).toBe('ready');
    expect(failed.loadingMore).toBe(false);
    expect(failed.loadMoreError).toBe(true);
    expect(failed.nextCursor).toBe('cursor-9');
    expect(failed.items.map((entry) => entry.postId)).toEqual([
      'post-10',
      'post-9',
    ]);

    const afterRealtime = reduceCommunityFeedState(failed, {
      type: 'realtime',
      upserts: [item('post-11', 11_000)],
      metricPatches: [],
      removedIds: [],
    });

    expect(afterRealtime.loadMoreError).toBe(true);
    expect(afterRealtime.nextCursor).toBe('cursor-9');

    const retrying = reduceCommunityFeedState(afterRealtime, {
      type: 'loading',
      request: { cursor: 'cursor-9', append: true },
    });

    expect(retrying.loadingMore).toBe(true);
    expect(retrying.loadMoreError).toBe(false);
  });
});

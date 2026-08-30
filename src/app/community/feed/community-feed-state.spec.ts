import { describe, expect, it } from 'vitest';

import type {
  CommunityFeedItem,
  CommunityFeedPage,
} from '../data-access/community-feed.model';
import {
  INITIAL_COMMUNITY_FEED_STATE,
  MAX_COMMUNITY_FEED_REFERENCE_ITEMS,
  reduceCommunityFeedState,
} from './community-feed-state.model';

function item(postId: string, publishedAt: number): CommunityFeedItem {
  return {
    postId,
    kind: 'text',
    author: {
      label: postId,
      avatarUrl: null,
    },
    text: `Mensagem ${postId}`,
    image: null,
    location: null,
    replyTo: null,
    metrics: {
      commentCount: 0,
      reactionCount: 0,
    },
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

function page(items: readonly CommunityFeedItem[]): CommunityFeedPage {
  return {
    items: [...items],
    nextCursor: null,
    generatedAt: Date.now(),
  };
}

describe('community feed state', () => {
  it('preserva a janela durante refresh, mas substitui histórico obsoleto no sucesso', () => {
    const initial = reduceCommunityFeedState(INITIAL_COMMUNITY_FEED_STATE, {
      type: 'success',
      request: { cursor: null, append: false },
      page: page([
        item('post-atual', 300),
        item('post-antigo', 100),
      ]),
    });

    const refreshing = reduceCommunityFeedState(initial, {
      type: 'loading',
      request: { cursor: null, append: false, preserve: true },
    });

    expect(refreshing.items.map((current) => current.postId)).toEqual([
      'post-atual',
      'post-antigo',
    ]);

    const refreshed = reduceCommunityFeedState(refreshing, {
      type: 'success',
      request: { cursor: null, append: false, preserve: true },
      page: page([item('post-novo', 400), item('post-atual', 300)]),
    });

    expect(refreshed.items.map((current) => current.postId)).toEqual([
      'post-novo',
      'post-atual',
    ]);
    expect(refreshed.items.some((current) => current.postId === 'post-antigo')).toBe(false);
    expect(refreshed.referenceOnlyIds).toEqual([]);
  });

  it('continua acumulando histórico apenas em paginação explícita', () => {
    const initial = reduceCommunityFeedState(INITIAL_COMMUNITY_FEED_STATE, {
      type: 'success',
      request: { cursor: null, append: false },
      page: page([item('post-2', 200)]),
    });

    const paginated = reduceCommunityFeedState(initial, {
      type: 'success',
      request: { cursor: 'post-2', append: true },
      page: page([item('post-1', 100)]),
    });

    expect(paginated.items.map((current) => current.postId)).toEqual([
      'post-2',
      'post-1',
    ]);
  });

  it('limita referências hidratadas sem expulsar conteúdo canônico do Mural', () => {
    let state = reduceCommunityFeedState(INITIAL_COMMUNITY_FEED_STATE, {
      type: 'success',
      request: { cursor: null, append: false },
      page: page([item('post-atual', 10_000)]),
    });

    for (let index = 1; index <= MAX_COMMUNITY_FEED_REFERENCE_ITEMS + 2; index += 1) {
      state = reduceCommunityFeedState(state, {
        type: 'reference',
        item: item(`referencia-${index}`, 10_000 - index),
      });
    }

    expect(state.referenceOnlyIds).toHaveLength(MAX_COMMUNITY_FEED_REFERENCE_ITEMS);
    expect(state.referenceOnlyIds).toEqual([
      'referencia-3',
      'referencia-4',
      'referencia-5',
      'referencia-6',
      'referencia-7',
      'referencia-8',
    ]);
    expect(state.items.some((current) => current.postId === 'post-atual')).toBe(true);
    expect(state.items.some((current) => current.postId === 'referencia-1')).toBe(false);
    expect(state.items.some((current) => current.postId === 'referencia-2')).toBe(false);
  });

  it('promove uma referência quando a paginação passa a entregá-la canonicamente', () => {
    const initial = reduceCommunityFeedState(INITIAL_COMMUNITY_FEED_STATE, {
      type: 'success',
      request: { cursor: null, append: false },
      page: page([item('post-2', 200)]),
    });
    const referenced = reduceCommunityFeedState(initial, {
      type: 'reference',
      item: item('post-1', 100),
    });

    expect(referenced.referenceOnlyIds).toEqual(['post-1']);

    const paginated = reduceCommunityFeedState(referenced, {
      type: 'success',
      request: { cursor: 'post-2', append: true },
      page: page([item('post-1', 100)]),
    });

    expect(paginated.referenceOnlyIds).toEqual([]);
    expect(paginated.items.map((current) => current.postId)).toEqual([
      'post-2',
      'post-1',
    ]);
  });
});

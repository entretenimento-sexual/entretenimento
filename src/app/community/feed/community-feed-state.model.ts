// src/app/community/feed/community-feed-state.model.ts
import {
  CommunityFeedItem,
  CommunityFeedPage,
} from '../data-access/community-feed.model';

export type CommunityFeedStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface CommunityFeedState {
  status: CommunityFeedStatus;
  items: readonly CommunityFeedItem[];
  nextCursor: string | null;
  loadingMore: boolean;
}

export interface CommunityFeedLoadRequest {
  cursor: string | null;
  append: boolean;
}

export type CommunityFeedLoadEvent =
  | { type: 'loading'; request: CommunityFeedLoadRequest }
  | { type: 'success'; request: CommunityFeedLoadRequest; page: CommunityFeedPage }
  | { type: 'error'; request: CommunityFeedLoadRequest };

export const INITIAL_COMMUNITY_FEED_STATE: CommunityFeedState = Object.freeze({
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
});

function mergeUniqueItems(
  currentItems: readonly CommunityFeedItem[],
  incomingItems: readonly CommunityFeedItem[]
): readonly CommunityFeedItem[] {
  const merged = new Map<string, CommunityFeedItem>();

  for (const item of currentItems) merged.set(item.postId, item);
  for (const item of incomingItems) merged.set(item.postId, item);

  return [...merged.values()];
}

export function reduceCommunityFeedState(
  state: CommunityFeedState,
  event: CommunityFeedLoadEvent
): CommunityFeedState {
  if (event.type === 'loading') {
    return event.request.append
      ? { ...state, loadingMore: true }
      : INITIAL_COMMUNITY_FEED_STATE;
  }

  if (event.type === 'error') {
    return event.request.append && state.items.length > 0
      ? { ...state, status: 'ready', loadingMore: false }
      : {
          status: 'error',
          items: [],
          nextCursor: null,
          loadingMore: false,
        };
  }

  const items = event.request.append
    ? mergeUniqueItems(state.items, event.page.items)
    : event.page.items;

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
  };
}

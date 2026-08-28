// src/app/community/topics/community-topics-state.model.ts
import {
  CommunityTopicListItem,
  CommunityTopicPage,
  CommunityTopicRepliesPage,
  CommunityTopicReplyItem,
} from '../data-access/community-topic.model';

export type CommunityTopicsStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface CommunityTopicsState {
  readonly status: CommunityTopicsStatus;
  readonly items: readonly CommunityTopicListItem[];
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
}

export interface CommunityTopicRepliesState {
  readonly status: CommunityTopicsStatus;
  readonly items: readonly CommunityTopicReplyItem[];
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
}

export interface CommunityTopicsLoadRequest {
  readonly cursor: string | null;
  readonly append: boolean;
}

export type CommunityTopicsLoadEvent =
  | { readonly type: 'loading'; readonly request: CommunityTopicsLoadRequest }
  | {
      readonly type: 'success';
      readonly request: CommunityTopicsLoadRequest;
      readonly page: CommunityTopicPage;
    }
  | { readonly type: 'error'; readonly request: CommunityTopicsLoadRequest };

export type CommunityTopicRepliesLoadEvent =
  | { readonly type: 'loading'; readonly request: CommunityTopicsLoadRequest }
  | {
      readonly type: 'success';
      readonly request: CommunityTopicsLoadRequest;
      readonly page: CommunityTopicRepliesPage;
    }
  | { readonly type: 'error'; readonly request: CommunityTopicsLoadRequest };

export const INITIAL_COMMUNITY_TOPICS_STATE: CommunityTopicsState = Object.freeze({
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
});

export const INITIAL_COMMUNITY_TOPIC_REPLIES_STATE: CommunityTopicRepliesState = Object.freeze({
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
});

function mergeTopics(
  current: readonly CommunityTopicListItem[],
  incoming: readonly CommunityTopicListItem[]
): readonly CommunityTopicListItem[] {
  const merged = new Map<string, CommunityTopicListItem>();
  for (const item of current) merged.set(item.topicId, item);
  for (const item of incoming) merged.set(item.topicId, item);
  return [...merged.values()];
}

function mergeReplies(
  current: readonly CommunityTopicReplyItem[],
  incoming: readonly CommunityTopicReplyItem[]
): readonly CommunityTopicReplyItem[] {
  const merged = new Map<string, CommunityTopicReplyItem>();
  for (const item of current) merged.set(item.replyId, item);
  for (const item of incoming) merged.set(item.replyId, item);
  return [...merged.values()];
}

export function reduceCommunityTopicsState(
  state: CommunityTopicsState,
  event: CommunityTopicsLoadEvent
): CommunityTopicsState {
  if (event.type === 'loading') {
    return event.request.append
      ? { ...state, loadingMore: true }
      : INITIAL_COMMUNITY_TOPICS_STATE;
  }

  if (event.type === 'error') {
    return event.request.append && state.items.length > 0
      ? { ...state, status: 'ready', loadingMore: false }
      : { status: 'error', items: [], nextCursor: null, loadingMore: false };
  }

  const items = event.request.append
    ? mergeTopics(state.items, event.page.items)
    : event.page.items;

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
  };
}

export function reduceCommunityTopicRepliesState(
  state: CommunityTopicRepliesState,
  event: CommunityTopicRepliesLoadEvent
): CommunityTopicRepliesState {
  if (event.type === 'loading') {
    return event.request.append
      ? { ...state, loadingMore: true }
      : INITIAL_COMMUNITY_TOPIC_REPLIES_STATE;
  }

  if (event.type === 'error') {
    return event.request.append && state.items.length > 0
      ? { ...state, status: 'ready', loadingMore: false }
      : { status: 'error', items: [], nextCursor: null, loadingMore: false };
  }

  const items = event.request.append
    ? mergeReplies(state.items, event.page.items)
    : event.page.items;

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
  };
}

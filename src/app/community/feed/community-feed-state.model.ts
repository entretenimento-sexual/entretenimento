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
  preserve?: boolean;
}

export interface CommunityFeedMetricPatch {
  postId: string;
  metrics: CommunityFeedItem['metrics'];
}

export type CommunityFeedLoadEvent =
  | { type: 'loading'; request: CommunityFeedLoadRequest }
  | { type: 'success'; request: CommunityFeedLoadRequest; page: CommunityFeedPage }
  | { type: 'error'; request: CommunityFeedLoadRequest }
  | {
      type: 'realtime';
      upserts: readonly CommunityFeedItem[];
      metricPatches: readonly CommunityFeedMetricPatch[];
      removedIds: readonly string[];
    };

export const INITIAL_COMMUNITY_FEED_STATE: CommunityFeedState = Object.freeze({
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
});

function sortItems(items: readonly CommunityFeedItem[]): readonly CommunityFeedItem[] {
  return [...items].sort((left, right) =>
    right.publishedAt - left.publishedAt || left.postId.localeCompare(right.postId)
  );
}

function mergeUniqueItems(
  currentItems: readonly CommunityFeedItem[],
  incomingItems: readonly CommunityFeedItem[]
): readonly CommunityFeedItem[] {
  const merged = new Map<string, CommunityFeedItem>();

  for (const item of currentItems) merged.set(item.postId, item);
  for (const item of incomingItems) merged.set(item.postId, item);

  return sortItems([...merged.values()]);
}

function applyRealtimeEvent(
  state: CommunityFeedState,
  event: Extract<CommunityFeedLoadEvent, { type: 'realtime' }>
): CommunityFeedState {
  const removedIds = new Set(event.removedIds);
  const metricById = new Map(
    event.metricPatches.map((patch) => [patch.postId, patch.metrics])
  );
  const remaining = state.items
    .filter((item) => !removedIds.has(item.postId))
    .map((item) => {
      const metrics = metricById.get(item.postId);
      return metrics ? { ...item, metrics: { ...metrics } } : item;
    });
  const items = mergeUniqueItems(remaining, event.upserts);

  return {
    ...state,
    status: items.length > 0
      ? 'ready'
      : state.status === 'loading'
        ? 'loading'
        : 'empty',
    items,
    // Realtime pode chegar enquanto uma página antiga está sendo buscada.
    // Ele não conclui nem cancela essa paginação; manter loadingMore evita
    // reabilitar o botão prematuramente e comunicar um estado falso ao usuário.
    loadingMore: state.loadingMore,
  };
}

export function reduceCommunityFeedState(
  state: CommunityFeedState,
  event: CommunityFeedLoadEvent
): CommunityFeedState {
  if (event.type === 'realtime') {
    return applyRealtimeEvent(state, event);
  }

  if (event.type === 'loading') {
    if (event.request.append) {
      return { ...state, loadingMore: true };
    }
    if (event.request.preserve && state.items.length > 0) {
      return { ...state, loadingMore: false };
    }
    return INITIAL_COMMUNITY_FEED_STATE;
  }

  if (event.type === 'error') {
    if ((event.request.append || event.request.preserve) && state.items.length > 0) {
      return { ...state, status: 'ready', loadingMore: false };
    }
    return {
      status: 'error',
      items: [],
      nextCursor: null,
      loadingMore: false,
    };
  }

  /**
   * `preserve` é uma política visual de stale-while-refresh: mantém a janela
   * atual durante loading/falha, mas não transforma a primeira página nova em
   * append. Quando o refresh conclui, a resposta autoritativa substitui a
   * janela atual e elimina itens antigos/hidratados que não pertencem mais ao
   * recorte inicial. Apenas paginação explícita continua acumulando histórico.
   */
  const items = event.request.append
    ? mergeUniqueItems(state.items, event.page.items)
    : sortItems(event.page.items);

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
  };
}

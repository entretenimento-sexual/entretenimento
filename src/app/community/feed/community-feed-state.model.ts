import {
  CommunityFeedItem,
  CommunityFeedPage,
} from '../data-access/community-feed.model';

export type CommunityFeedStatus = 'loading' | 'ready' | 'empty' | 'error';

export const MAX_COMMUNITY_FEED_REFERENCE_ITEMS = 6;

export interface CommunityFeedState {
  status: CommunityFeedStatus;
  items: readonly CommunityFeedItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  loadMoreError: boolean;
  /**
   * Itens hidratados apenas para resolver uma referência fora da janela
   * corrente. O reducer mantém esta fila limitada e a promove para conteúdo
   * canônico quando paginação/realtime entrega o mesmo post.
   */
  referenceOnlyIds: readonly string[];
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
    }
  | {
      type: 'reference';
      item: CommunityFeedItem;
    };

export const INITIAL_COMMUNITY_FEED_STATE: CommunityFeedState = Object.freeze({
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
  loadMoreError: false,
  referenceOnlyIds: [],
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

function applyReferenceEvent(
  state: CommunityFeedState,
  event: Extract<CommunityFeedLoadEvent, { type: 'reference' }>
): CommunityFeedState {
  const postId = event.item.postId;
  const alreadyVisible = state.items.some((item) => item.postId === postId);
  const alreadyReferenceOnly = state.referenceOnlyIds.includes(postId);

  if (alreadyVisible && !alreadyReferenceOnly) {
    return {
      ...state,
      items: mergeUniqueItems(state.items, [event.item]),
    };
  }

  const queue = [
    ...state.referenceOnlyIds.filter((referenceId) => referenceId !== postId),
    postId,
  ];
  const overflow = Math.max(
    0,
    queue.length - MAX_COMMUNITY_FEED_REFERENCE_ITEMS
  );
  const evictedIds = new Set(queue.slice(0, overflow));
  const referenceOnlyIds = queue.slice(overflow);
  const items = mergeUniqueItems(
    state.items.filter((item) => !evictedIds.has(item.postId)),
    [event.item]
  );

  return {
    ...state,
    status: items.length > 0 ? 'ready' : state.status,
    items,
    referenceOnlyIds,
  };
}

function applyRealtimeEvent(
  state: CommunityFeedState,
  event: Extract<CommunityFeedLoadEvent, { type: 'realtime' }>
): CommunityFeedState {
  const removedIds = new Set(event.removedIds);
  const canonicalUpsertIds = new Set(event.upserts.map((item) => item.postId));
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
  const referenceOnlyIds = state.referenceOnlyIds.filter(
    (postId) => !removedIds.has(postId) && !canonicalUpsertIds.has(postId)
  );

  return {
    ...state,
    status: items.length > 0
      ? 'ready'
      : state.status === 'loading'
        ? 'loading'
        : 'empty',
    items,
    referenceOnlyIds,
    // Realtime pode chegar enquanto uma página antiga está sendo buscada.
    // Ele não conclui nem cancela essa paginação; manter loadingMore evita
    // reabilitar o botão prematuramente e comunicar um estado falso ao usuário.
    loadingMore: state.loadingMore,
    // Uma chegada realtime também não deve apagar o aviso de uma paginação
    // anterior que falhou. O retry continua apontando para o mesmo cursor.
    loadMoreError: state.loadMoreError,
  };
}

export function reduceCommunityFeedState(
  state: CommunityFeedState,
  event: CommunityFeedLoadEvent
): CommunityFeedState {
  if (event.type === 'reference') {
    return applyReferenceEvent(state, event);
  }

  if (event.type === 'realtime') {
    return applyRealtimeEvent(state, event);
  }

  if (event.type === 'loading') {
    if (event.request.append) {
      return {
        ...state,
        loadingMore: true,
        loadMoreError: false,
      };
    }
    if (event.request.preserve && state.items.length > 0) {
      return {
        ...state,
        loadingMore: false,
        loadMoreError: false,
      };
    }
    return INITIAL_COMMUNITY_FEED_STATE;
  }

  if (event.type === 'error') {
    if (event.request.append && state.items.length > 0) {
      return {
        ...state,
        status: 'ready',
        loadingMore: false,
        loadMoreError: true,
      };
    }
    if (event.request.preserve && state.items.length > 0) {
      return {
        ...state,
        status: 'ready',
        loadingMore: false,
        loadMoreError: false,
      };
    }
    return {
      status: 'error',
      items: [],
      nextCursor: null,
      loadingMore: false,
      loadMoreError: false,
      referenceOnlyIds: [],
    };
  }

  /**
   * `preserve` é uma política visual de stale-while-refresh: mantém a janela
   * atual durante loading/falha, mas não transforma a primeira página nova em
   * append. Quando o refresh conclui, a resposta autoritativa substitui a
   * janela atual e elimina itens antigos/hidratados que não pertencem mais ao
   * recorte inicial. Apenas paginação explícita continua acumulando histórico.
   */
  const pageIds = new Set(event.page.items.map((item) => item.postId));
  const items = event.request.append
    ? mergeUniqueItems(state.items, event.page.items)
    : sortItems(event.page.items);
  const referenceOnlyIds = event.request.append
    ? state.referenceOnlyIds.filter((postId) => !pageIds.has(postId))
    : [];

  return {
    status: items.length > 0 ? 'ready' : 'empty',
    items,
    nextCursor: event.page.nextCursor,
    loadingMore: false,
    loadMoreError: false,
    referenceOnlyIds,
  };
}

// src/app/store/selectors/selectors.interactions/friends/pagination.selectors.ts
// Factory selectors por UID (com cache) + API compatível com o projeto.
// - Mantém os exports existentes: selectFriendsPageItems/loading/reachedEnd/nextOrder/count/onlineCount/offlineCount
// - Evita criar instâncias infinitas de selectors quando o UID muda ao longo da sessão.
// - Exponibiliza clearFriendsPaginationSelectorsCache() para limpeza no logout.
// src/app/store/selectors/selectors.interactions/friends/pagination.selectors.ts
import {
  createFeatureSelector,
  createSelector,
  MemoizedSelector,
} from '@ngrx/store';

import { FriendsPaginationState } from '../../../states/states.interactions/friends-pagination.state';

export const FRIENDS_PAGES_FEATURE = 'friendsPages';

export const selectFriendsPagesState =
  createFeatureSelector<FriendsPaginationState>(FRIENDS_PAGES_FEATURE);

// -----------------------------------------------------------------------------
// Tipos auxiliares
// -----------------------------------------------------------------------------
type FriendsPageSlice = FriendsPaginationState['byUid'][string] | undefined;

// ✅ AQUI: “Sel<T>” mantém o tipo do resultado (T) e relaxa apenas o projector
type Sel<T> = MemoizedSelector<object, T, any>;

function normUid(uid: string): string {
  return (uid ?? '').trim();
}

function getOrCreate<T>(
  cache: Map<string, Sel<T>>,
  uid: string,
  factory: () => Sel<T>
): Sel<T> {
  const key = normUid(uid);
  let sel = cache.get(key);
  if (!sel) {
    sel = factory();
    cache.set(key, sel);
  }
  return sel;
}

// -----------------------------------------------------------------------------
// Base: slice por UID
// -----------------------------------------------------------------------------
const sliceCache = new Map<string, Sel<FriendsPageSlice>>();

export const selectFriendsPageSlice = (uid: string): Sel<FriendsPageSlice> =>
  getOrCreate(sliceCache, uid, () =>
    createSelector(selectFriendsPagesState, (s) => {
      const key = normUid(uid);
      return s?.byUid?.[key];
    }) as Sel<FriendsPageSlice>
  );

// Alias compatível
export const selectFriendsPageState = selectFriendsPageSlice;

// -----------------------------------------------------------------------------
// Leafs: mantendo os nomes usados no app
// -----------------------------------------------------------------------------
const itemsCache = new Map<string, Sel<any[]>>();
export const selectFriendsPageItems = (uid: string) =>
  getOrCreate(itemsCache, uid, () =>
    createSelector(selectFriendsPageSlice(uid), (slice) => slice?.items ?? []) as Sel<any[]>
  );

const loadingCache = new Map<string, Sel<boolean>>();
export const selectFriendsPageLoading = (uid: string) =>
  getOrCreate(loadingCache, uid, () =>
    createSelector(selectFriendsPageSlice(uid), (slice) => !!slice?.loading) as Sel<boolean>
  );

const reachedEndCache = new Map<string, Sel<boolean>>();
export const selectFriendsPageReachedEnd = (uid: string) =>
  getOrCreate(reachedEndCache, uid, () =>
    createSelector(selectFriendsPageSlice(uid), (slice) => !!slice?.reachedEnd) as Sel<boolean>
  );

const nextOrderCache = new Map<string, Sel<number | null>>();
export const selectFriendsPageNextOrder = (uid: string) =>
  getOrCreate(nextOrderCache, uid, () =>
    createSelector(selectFriendsPageSlice(uid), (slice) => slice?.nextOrderValue ?? null) as Sel<number | null>
  );

const countCache = new Map<string, Sel<number>>();
export const selectFriendsPageCount = (uid: string) =>
  getOrCreate(countCache, uid, () =>
    createSelector(selectFriendsPageItems(uid), (items) => items.length) as Sel<number>
  );

const onlineCountCache = new Map<string, Sel<number>>();
export const selectFriendsPageOnlineCount = (uid: string) =>
  getOrCreate(onlineCountCache, uid, () =>
    createSelector(selectFriendsPageItems(uid), (items) =>
      items.filter((f) => !!(f as any)?.isOnline).length
    ) as Sel<number>
  );

const offlineCountCache = new Map<string, Sel<number>>();
export const selectFriendsPageOfflineCount = (uid: string) =>
  getOrCreate(offlineCountCache, uid, () =>
    createSelector(selectFriendsPageItems(uid), (items) =>
      items.filter((f) => !((f as any)?.isOnline)).length
    ) as Sel<number>
  );

// -----------------------------------------------------------------------------
// Limpeza do cache
// -----------------------------------------------------------------------------
export function clearFriendsPaginationSelectorsCache(): void {
  sliceCache.clear();
  itemsCache.clear();
  loadingCache.clear();
  reachedEndCache.clear();
  nextOrderCache.clear();
  countCache.clear();
  onlineCountCache.clear();
  offlineCountCache.clear();
}

export const __friendsPaginationSelectorsDebug = {
  cacheSizes: () => ({
    slice: sliceCache.size,
    items: itemsCache.size,
    loading: loadingCache.size,
    reachedEnd: reachedEndCache.size,
    nextOrder: nextOrderCache.size,
    count: countCache.size,
    onlineCount: onlineCountCache.size,
    offlineCount: offlineCountCache.size,
  }),
};

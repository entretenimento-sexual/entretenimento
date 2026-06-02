// src/app/store/reducers/reducers.interactions/friends-pagination.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { FriendsPaginationState, initialFriendsPaginationState, emptyFriendsPageSlice,
        } from '../../states/states.interactions/friends-pagination.state';
import * as P from '../../actions/actions.interactions/friends/friends-pagination.actions';
import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';

function ensureSlice(state: FriendsPaginationState, uid: string) {
  return state.byUid[uid] ?? emptyFriendsPageSlice;
}

function dedupeByFriendUid(list: Friend[]): Friend[] {
  const map = new Map<string, Friend>();
  for (const f of list) {
    const key = (f as any).friendUid ?? (f as any).uid;
    if (!key) continue;
    map.set(key, f);
  }
  return Array.from(map.values());
}

function normalizeUid(value: unknown): string {
  return String(value ?? '').trim();
}

function isSameFriend(item: Friend, friendUid: string): boolean {
  const target = normalizeUid(friendUid);

  if (!target) {
    return false;
  }

  const candidates = [
    (item as any).friendUid,
    (item as any).uid,
    (item as any).id,
  ];

  return candidates.some(candidate => normalizeUid(candidate) === target);
}

export const friendsPaginationReducer = createReducer(
  initialFriendsPaginationState,

  // First / Refresh => replace: zera itens antes de carregar
  on(P.loadFriendsFirstPage, (state, { uid }) => ({
    ...state,
    byUid: { ...state.byUid, [uid]: { ...emptyFriendsPageSlice, loading: true } },
  })),

  on(P.refreshFriendsPage, (state, { uid }) => ({
    ...state,
    byUid: { ...state.byUid, [uid]: { ...emptyFriendsPageSlice, loading: true } },
  })),

  // Next => append: mantém itens e só liga loading
  on(P.loadFriendsNextPage, (state, { uid }) => {
    const current = ensureSlice(state, uid);
    return {
      ...state,
      byUid: { ...state.byUid, [uid]: { ...current, loading: true, error: null } },
    };
  }),

  // Success (append controla merge ou replace)
  on(P.loadFriendsPageSuccess, (state, { uid, items, nextOrderValue, reachedEnd, append }) => {
    const current = ensureSlice(state, uid);
    const merged = append ? [...current.items, ...items] : items;
    const deduped = dedupeByFriendUid(merged);

    return {
      ...state,
      byUid: {
        ...state.byUid,
        [uid]: {
          ...current,
          items: deduped,
          nextOrderValue,
          reachedEnd,
          loading: false,
          error: null,
        },
      },
    };
  }),

  // Failure
  on(P.loadFriendsPageFailure, (state, { uid, error }) => {
    const current = ensureSlice(state, uid);
    return {
      ...state,
      byUid: { ...state.byUid, [uid]: { ...current, loading: false, error } },
    };
  }),

  /**
 * Remove localmente o amigo da lista paginada.
 *
 * Motivo:
 * - a tela /friends/list consome selectFriendsPageItems(uid);
 * - endFriendshipSuccess atualizava apenas o FriendsState principal;
 * - sem este handler, o card podia continuar visível até refresh/reload.
 */
on(P.removeFriendFromFriendsPage, (state, { uid, friendUid }) => {
  const current = ensureSlice(state, uid);

  return {
    ...state,
    byUid: {
      ...state.byUid,
      [uid]: {
        ...current,
        items: current.items.filter(item => !isSameFriend(item, friendUid)),
        loading: false,
        error: null,
      },
    },
  };
}),

  // Reset
  on(P.resetFriendsPagination, (state, { uid }) => {
    const { [uid]: _, ...rest } = state.byUid;
    return { ...state, byUid: rest };
  }),
);

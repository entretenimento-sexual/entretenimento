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

  // Reset
  on(P.resetFriendsPagination, (state, { uid }) => {
    const { [uid]: _, ...rest } = state.byUid;
    return { ...state, byUid: rest };
  }),
);

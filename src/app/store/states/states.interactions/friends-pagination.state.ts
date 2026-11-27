// src/app/store/states/states.interactions/friends-pagination.state.ts
import { Friend, type FriendsPageCursor } from 'src/app/core/interfaces/friendship/friend.interface';

export interface FriendsPageSlice {
  items: Friend[];
  /** Cursor composto serializável; sem instância de Timestamp. */
  nextOrderValue: FriendsPageCursor | null;
  reachedEnd: boolean;
  loading: boolean;
  error: string | null;
}

export interface FriendsPaginationState {
  byUid: Record<string, FriendsPageSlice>;
  }

export const emptyFriendsPageSlice: FriendsPageSlice = {
  items: [],
  nextOrderValue: null,
  reachedEnd: false,
  loading: false,
  error: null,
};

export const initialFriendsPaginationState: FriendsPaginationState = { byUid: {} };

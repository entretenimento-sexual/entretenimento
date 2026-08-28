// src/app/store/states/states.interactions/friends-pagination.state.ts
import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';

export interface FriendsPageSlice {
  items: Friend[];
  /**
   * ✅ Store serializável: cursor sempre epoch (number) ou null.
   * (nada de Timestamp aqui)
   */
  nextOrderValue: number | null;
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

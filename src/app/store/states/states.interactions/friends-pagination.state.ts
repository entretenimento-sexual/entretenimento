// src/app/store/states/states.interactions/friends-pagination.state.ts
import { Friend, type FriendsPageCursor } from 'src/app/core/interfaces/friendship/friend.interface';

/** Última projeção da primeira página viva e seu cursor bruto. */
export interface FriendsFirstPage {
  items: Friend[];
  nextOrderValue: FriendsPageCursor | null;
  reachedEnd: boolean;
}

export interface FriendsPageSlice {
  firstPage?: FriendsFirstPage | null;
  tailConfirmed?: boolean;
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
  firstPage: null,
  tailConfirmed: false,
  nextOrderValue: null,
  reachedEnd: false,
  loading: false,
  error: null,
};

export const initialFriendsPaginationState: FriendsPaginationState = { byUid: {} };

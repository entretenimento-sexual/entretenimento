// src/app/store/selectors/selectors.interactions/friends/pagination.selectors.ts
import { createSelector, createFeatureSelector } from '@ngrx/store';
import { FriendsPaginationState } from '../../../states/states.interactions/friends-pagination.state';

export const FRIENDS_PAGES_FEATURE = 'friendsPages';

export const selectFriendsPagesState =
  createFeatureSelector<FriendsPaginationState>(FRIENDS_PAGES_FEATURE);

export const selectFriendsPageSlice = (uid: string) =>
  createSelector(selectFriendsPagesState, (s) => s.byUid[uid]);

export const selectFriendsPageItems = (uid: string) =>
  createSelector(selectFriendsPageSlice(uid), (slice) => slice?.items ?? []);

export const selectFriendsPageLoading = (uid: string) =>
  createSelector(selectFriendsPageSlice(uid), (slice) => !!slice?.loading);

export const selectFriendsPageReachedEnd = (uid: string) =>
  createSelector(selectFriendsPageSlice(uid), (slice) => !!slice?.reachedEnd);

export const selectFriendsPageNextOrder = (uid: string) =>
  createSelector(selectFriendsPageSlice(uid), (slice) => slice?.nextOrderValue ?? null);

export const selectFriendsPageCount = (uid: string) =>
  createSelector(selectFriendsPageItems(uid), (items) => items.length);

export const selectFriendsPageOnlineCount = (uid: string) =>
  createSelector(selectFriendsPageItems(uid), (items) => items.filter(f => !!(f as any).isOnline).length);
export const selectFriendsPageOfflineCount = (uid: string) =>
  createSelector(selectFriendsPageItems(uid), (items) => items.filter(f => !((f as any).isOnline)).length);

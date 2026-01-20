// src/app/store/actions/actions.interactions/friends/friends-pagination.actions.ts
import { createAction, props } from '@ngrx/store';
import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';

export const loadFriendsFirstPage = createAction(
  '[Friends Page] Load First',
  props<{ uid: string; pageSize?: number }>()
);

export const loadFriendsNextPage = createAction(
  '[Friends Page] Load Next',
  props<{ uid: string; pageSize?: number }>()
);

export const refreshFriendsPage = createAction(
  '[Friends Page] Refresh',
  props<{ uid: string; pageSize?: number }>()
);

export const loadFriendsPageSuccess = createAction(
  '[Friends Page] Success',
  props<{
    uid: string;
    items: Friend[];

    /**
     * ✅ Store serializável:
     * cursor sempre como epoch (number) ou null.
     * Quem lê Firestore converte Timestamp => epoch (toMillis) antes do dispatch.
     * Quem monta query converte epoch => Timestamp (Timestamp.fromMillis) quando necessário.
     */
    nextOrderValue: number | null;

    reachedEnd: boolean;
    append: boolean; // false = replace(first/refresh), true = append(next)
  }>()
);

export const loadFriendsPageFailure = createAction(
  '[Friends Page] Failure',
  props<{ uid: string; error: string }>()
);

export const resetFriendsPagination = createAction(
  '[Friends Page] Reset',
  props<{ uid: string }>()
);

//Timestamp não é serializável
//src\app\store\utils\user-store.serializer.ts

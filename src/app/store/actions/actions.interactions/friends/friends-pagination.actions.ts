// src/app/store/actions/actions.interactions/friends/friends-pagination.actions.ts
import { createAction, props } from '@ngrx/store';
import { Friend, type FriendsPageCursor } from 'src/app/core/interfaces/friendship/friend.interface';

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

    /** Cursor composto serializável; sem instância de Timestamp. */
    nextOrderValue: FriendsPageCursor | null;

    reachedEnd: boolean;
    append: boolean; // false = replace(first/refresh), true = append(next)
  }>()
);

export const loadFriendsPageFailure = createAction(
  '[Friends Page] Failure',
  props<{ uid: string; error: string; replace?: boolean }>()
);

export const resetFriendsPagination = createAction(
  '[Friends Page] Reset',
  props<{ uid: string }>()
);

/**
 * Remove localmente um amigo da página paginada.
 *
 * Uso:
 * - após endFriendshipSuccess;
 * - evita que a UI continue exibindo um card stale vindo do slice paginado;
 * - não substitui a validação backend, apenas sincroniza a tela.
 */
export const removeFriendFromFriendsPage = createAction(
  '[Friends Page] Remove Friend Locally',
  props<{ uid: string; friendUid: string }>()
);

//Timestamp não é serializável
//src\app\store\utils\user-store.serializer.ts

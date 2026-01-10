//src\app\store\actions\actions.interactions\friends\friends-list.actions.ts
import { createAction, props } from '@ngrx/store';
import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';

// -----------------------------
// Friends (lista do usuário)
// -----------------------------
export const loadFriends = createAction(
  '[Friendship] Load Friends',
  props<{ uid: string }>()
);

export const loadFriendsSuccess = createAction(
  '[Friendship] Load Friends Success',
  props<{ friends: Friend[] }>()
);

export const loadFriendsFailure = createAction(
  '[Friendship] Load Friends Failure',
  props<{ error: string }>()
);

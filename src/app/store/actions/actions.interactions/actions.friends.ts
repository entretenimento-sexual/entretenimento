// src\app\store\actions\actions.interactions\actions.friends.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// 🔄 Carregar amigos
export const loadFriends = createAction('[Friends] Load Friends', props<{ uid: string }>());
export const loadFriendsSuccess = createAction('[Friends] Load Friends Success', props<{ friends: IUserDados[] }>());
export const loadFriendsFailure = createAction('[Friends] Load Friends Failure', props<{ error: string }>());

// 📩 Carregar pedidos de amizade
export const loadRequests = createAction('[Friends] Load Requests');
export const loadRequestsSuccess = createAction('[Friends] Load Requests Success', props<{ requests: IUserDados[] }>());

// 🚫 Carregar lista de bloqueados
export const loadBlocked = createAction('[Friends] Load Blocked');
export const loadBlockedSuccess = createAction('[Friends] Load Blocked Success', props<{ blocked: IUserDados[] }>());

// ➕ Adicionar amigo
export const addFriend = createAction('[Friends] Add Friend', props<{ friend: IUserDados }>());
export const addFriendSuccess = createAction('[Friends] Add Friend Success', props<{ friend: IUserDados }>());

// 📡 Carregar resultados da pesquisa
export const loadSearchResultsSuccess = createAction('[Friends] Load Search Results Success',
  props<{ results: IUserDados[] }>()
);

// 🚫 Bloquear amigo
export const blockFriend = createAction('[Friends] Block Friend', props<{ uid: string }>());
export const blockFriendSuccess = createAction('[Friends] Block Friend Success', props<{ uid: string }>());

export const updateFriendSettings = createAction(
  '[Friends] Update Friend Settings',
  props<{ settings: { receiveRequests: boolean, showOnlineStatus: boolean, allowSearchByNickname: boolean } }>()
);

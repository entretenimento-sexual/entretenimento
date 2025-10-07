// src\app\store\actions\actions.interactions\actions.friends.ts
import { createAction, props } from '@ngrx/store';
import { IFriend } from 'src/app/core/interfaces/friendship/ifriend';
import { IFriendRequest } from 'src/app/core/interfaces/friendship/ifriend-request';
import { IBlockedUser } from 'src/app/core/interfaces/friendship/ifriend';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// 🔄 Carregar amigos (Corrigido para usar IFriend[])
export const loadFriends = createAction('[Friends] Load Friends', props<{ uid: string }>());
export const loadFriendsSuccess = createAction('[Friends] Load Friends Success', props<{ friends: IFriend[] }>());
export const loadFriendsFailure = createAction('[Friends] Load Friends Failure', props<{ error: string }>());

// 📩 Carregar pedidos de amizade (Corrigido para IFriendRequest[])
export const loadRequests = createAction('[Friends] Load Requests');
export const loadRequestsSuccess = createAction('[Friends] Load Requests Success', props<{ requests: IFriendRequest[] }>());
export const loadRequestsFailure = createAction('[Friends] Load Requests Failure', props<{ error: string }>());

// 🚫 Carregar lista de bloqueados (Corrigido para IBlockedUser[])
export const loadBlocked = createAction('[Friends] Load Blocked');
export const loadBlockedSuccess = createAction('[Friends] Load Blocked Success', props<{ blocked: IBlockedUser[] }>());

// ➕ Enviar solicitação de amizade (mantém IUserDados apenas para perfis)
export const sendFriendRequest = createAction('[Friends] Send Friend Request', props<{ userUid: string, friendUid: string; message?: string }>());
export const sendFriendRequestSuccess = createAction('[Friends] Send Friend Request Success', props<{ friend: IFriend }>());
export const sendFriendRequestFailure = createAction('[Friends] Send Friend Request Failure', props<{ error: string }>());

// 🚫 Bloquear usuário
export const blockFriend = createAction('[Friends] Block Friend', props<{ uid: string }>());
export const blockFriendSuccess = createAction('[Friends] Block Friend Success', props<{ uid: string }>());

// ✅ **Desbloquear usuário**
export const unblockFriend = createAction('[Friends] Unblock Friend', props<{ uid: string }>());
export const unblockFriendSuccess = createAction('[Friends] Unblock Friend Success', props<{ uid: string }>());


// 🔍 **Carregar resultados da pesquisa**
export const loadSearchResults = createAction('[Friends] Load Search Results', props<{ searchTerm: string }>());
export const loadSearchResultsSuccess = createAction('[Friends] Load Search Results Success', props<{ results: IUserDados[] }>());
export const loadSearchResultsFailure = createAction('[Friends] Load Search Results Failure', props<{ error: string }>()); // ✅ **Adicionado!**

// ⚙ Atualizar configurações de amizade
export const updateFriendSettings = createAction('[Friends] Update Friend Settings', props<{ settings: { receiveRequests: boolean; showOnlineStatus: boolean; allowSearchByNickname: boolean } }>());

export const resetSendFriendRequestStatus = createAction(
  '[Friends] Reset Send Friend Request Status'
);

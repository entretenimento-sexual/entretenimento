//src\app\store\actions\actions.interactions\friends\friends-misc.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// -----------------------------
// Utilitários de UI/estado local
// -----------------------------
export const resetSendFriendRequestStatus = createAction(
  '[Friendship] Reset Send Friend Request Status'
);

// Busca de usuários
export const loadSearchResults = createAction(
  '[Friendship] Load Search Results',
  props<{ searchTerm: string }>()
);

export const loadSearchResultsSuccess = createAction(
  '[Friendship] Load Search Results Success',
  props<{ results: IUserDados[] }>()
);

export const loadSearchResultsFailure = createAction(
  '[Friendship] Load Search Results Failure',
  props<{ error: string }>()
);

// Settings (preferências de amizade)
export const updateFriendSettings = createAction(
  '[Friendship] Update Friend Settings',
  props<{
    settings: {
      receiveRequests: boolean;
      showOnlineStatus: boolean;
      allowSearchByNickname: boolean;
    };
  }>()
);

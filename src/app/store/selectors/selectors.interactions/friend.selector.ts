//src\app\store\selectors\selectors.interactions\friend.selector.ts
import { createSelector, createFeatureSelector } from '@ngrx/store';
import { FriendsState } from '../../states/states.interactions/friends.state';

// 🔍 Obtém a Feature 'friends'
export const selectFriendsState = createFeatureSelector<FriendsState>('friends');

/** 🔄 SELETORES PARA AMIGOS */
// 🔥 Obtém a lista de todos os amigos
export const selectAllFriends = createSelector(
  selectFriendsState,
  (state: FriendsState) => Array.isArray(state.friends) ? state.friends : []
);

export const selectAllFriendsFlattened = createSelector(
  selectAllFriends,
  (friends) => friends.flat() // 🔥 Garante um array unidimensional
);

// 🔥 Obtém a contagem total de amigos
export const selectFriendsCount = createSelector(
  selectAllFriends,
  (friends) => friends.length
);

/** 📩 SELETORES PARA SOLICITAÇÕES DE AMIZADE */
// 🔥 Obtém a lista de todas as solicitações de amizade pendentes
export const selectFriendRequests = createSelector(
  selectFriendsState,
  (state: FriendsState) => state.requests
);

// 🔥 Obtém a contagem de solicitações pendentes
export const selectPendingFriendRequestsCount = createSelector(  // 🔥 Agora está corrigido
  selectFriendRequests,
  (requests) => requests ? requests.length : 0
);

/** 🚫 SELETORES PARA AMIGOS BLOQUEADOS */
// 🔥 Obtém a lista de usuários bloqueados
export const selectBlockedFriends = createSelector(
  selectFriendsState,
  (state: FriendsState) => state.blocked
);

// 🔥 Obtém a contagem de usuários bloqueados
export const selectBlockedFriendsCount = createSelector(
  selectBlockedFriends,
  (blocked) => blocked.length
);

/** ⏳ SELETORES PARA STATUS DE CARREGAMENTO */
// 🔥 Obtém o status de carregamento
export const selectFriendsLoading = createSelector(
  selectFriendsState,
  (state: FriendsState) => state.loading
);

// 🔥 Obtém se há alguma requisição de amizade sendo carregada
export const selectRequestsLoading = createSelector(
  selectFriendsState,
  (state: FriendsState) => state.loadingRequests
);

/** ❌ SELETOR DE ERROS */
// 🔥 Obtém os erros do estado de amigos
export const selectFriendsError = createSelector(
  selectFriendsState,
  (state: FriendsState) => state.error
);

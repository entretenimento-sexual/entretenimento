//src\app\store\selectors\selectors.interactions\friend.selector.ts
import { createSelector, createFeatureSelector } from '@ngrx/store';
import { FriendsState } from '../../states/states.interactions/friends.state';

// 🔍 Obtém a Feature 'friends'
export const selectFriendsState = createFeatureSelector<FriendsState>('friends');

// 🔄 Seleciona todos os amigos
export const selectAllFriends = createSelector(
  selectFriendsState,
  (state: FriendsState) => state.friends
);

// 📩 Seleciona todas as solicitações de amizade
export const selectFriendRequests = createSelector(
  selectFriendsState,
  (state: FriendsState) => state.requests
);

// 🚫 Seleciona todos os amigos bloqueados
export const selectBlockedFriends = createSelector(
  selectFriendsState,
  (state: FriendsState) => state.blocked
);

// ⏳ Seleciona o status de carregamento
export const selectFriendsLoading = createSelector(
  selectFriendsState,
  (state: FriendsState) => state.loading
);

// ❌ Seleciona os erros do estado de amigos
export const selectFriendsError = createSelector(
  selectFriendsState,
  (state: FriendsState) => state.error
);

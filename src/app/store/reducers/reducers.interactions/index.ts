// src/app/store/reducers/reducers.interactions/index.ts
// Não esqueça os comentários
import { friendsPaginationReducer } from './friends-pagination.reducer';
import { friendsReducer } from './friends.reducer';

export const interactionsReducers = {
  friendsPages: friendsPaginationReducer,
  interactions_friends: friendsReducer,
};

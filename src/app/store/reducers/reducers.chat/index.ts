// src/app/store/reducers/reducers.chat/index.ts
// Não esqueça os comentários
import { chatReducer } from './chat.reducer';
import { inviteReducer } from './invite.reducer';
import { roomReducer } from './room.reducer';

/**
 * Agrupador de reducers do domínio Chat.
 * Facilita importar no reducers/index.ts.
 */
export const chatReducers = {
  chat: chatReducer,
  invite: inviteReducer,
  room: roomReducer,
};

// src/app/store/reducers/reducers.chat/index.ts
import { inviteReducer } from './invite.reducer';

/**
 * Agrupador do estado global de mensageria.
 *
 * Somente convites permanecem no NgRx porque o badge precisa existir fora da
 * rota de chat. Chats diretos e salas são streams reativos com lifecycle por UID.
 */
export const chatReducers = {
  invite: inviteReducer,
};

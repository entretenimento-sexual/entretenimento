// src/app/store/reducers/reducers.chat/index.ts
// Não esqueça os comentários
import { chatReducer } from './chat.reducer';
import { inviteReducer } from './invite.reducer';

/**
 * Agrupador dos reducers globais do domínio Chat.
 *
 * Salas não mantêm uma segunda projeção no NgRx: leitura reativa pertence a
 * RoomService/RoomFirestoreGateway e comandos pertencem a
 * RoomManagementService/Cloud Functions.
 */
export const chatReducers = {
  chat: chatReducer,
  invite: inviteReducer,
};

// src/app/store/selectors/selectors.chat/room.selectors.ts
import { createSelector, createFeatureSelector } from '@ngrx/store';
import { ChatState } from '../../states/states.chat/chat.state';
import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';

// Seleciona o estado de chat (que inclui as salas)
export const selectChatState = createFeatureSelector<ChatState>('chat');

// Seleciona todas as salas de chat
export const selectAllRooms = createSelector(
  selectChatState,
  (state: ChatState) => state.chats.filter(chat => chat.isRoom)
);

// Seleciona uma sala específica pelo ID
export const selectRoomById = (roomId: string) => createSelector(
  selectAllRooms,
  (rooms: IChat[]) => rooms.find(room => room.id === roomId)
);

// Seleciona mensagens em uma sala específica
export const selectMessagesByRoomId = (roomId: string) => createSelector(
  selectChatState,
  (state: ChatState) => state.messages[roomId] || []
);

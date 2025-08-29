// src/app/store/selectors/selectors.chat/chat.selectors.ts
import { createSelector, createFeatureSelector } from '@ngrx/store';
import { ChatState } from '../../states/states.chat/chat.state';
import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';

// Seletor para o estado de conversas
export const selectChatState = createFeatureSelector<ChatState>('chat');

// Seleciona todas as conversas
export const selectAllChats = createSelector(
  selectChatState,
  (state: ChatState) => state.chats.filter(chat => !chat.isRoom)
);

// Seleciona uma conversa específica pelo ID
export const selectChatById = (chatId: string) => createSelector(
  selectAllChats,
  (chats: IChat[]) => chats.find(chat => chat.id === chatId)
);

// Seleciona mensagens em uma conversa específica
export const selectMessagesByChatId = (chatId: string) => createSelector(
  selectChatState,
  (state: ChatState) => state.messages[chatId] || []
);

// src/app/store/states/states.chat/chat.state.ts
import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

export interface ChatState {
  chats: IChat[];          // Lista de conversas
  messages: {              // Dicionário de mensagens agrupadas por ID de chat
    [chatId: string]: Message[];
  };
  loading: boolean;        // Indicador de carregamento
  error: string | null;    // Mensagem de erro, caso ocorra
}

export const initialChatState: ChatState = {
  chats: [],
  messages: {},
  loading: false,
  error: null
};

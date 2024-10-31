// src/app/store/actions/actions.chat/chat.actions.ts
import { createAction, props } from '@ngrx/store';
import { Chat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

// Carregar conversas
export const LoadChats = createAction('[Chat] Load Chats');
export const LoadChatsSuccess = createAction(
  '[Chat] Load Chats Success',
  props<{ chats: Chat[] }>()
);
export const LoadChatsFailure = createAction(
  '[Chat] Load Chats Failure',
  props<{ error: string }>()
);

// Criar uma nova conversa
export const CreateChat = createAction(
  '[Chat] Create Chat',
  props<{ chat: Chat }>()
);
export const CreateChatSuccess = createAction(
  '[Chat] Create Chat Success',
  props<{ chat: Chat }>()
);
export const CreateChatFailure = createAction(
  '[Chat] Create Chat Failure',
  props<{ error: string }>()
);

// Enviar mensagem em uma conversa
export const SendMessage = createAction(
  '[Chat] Send Message',
  props<{ chatId: string, message: Message }>()
);
export const SendMessageSuccess = createAction(
  '[Chat] Send Message Success',
  props<{ message: Message }>()
);
export const SendMessageFailure = createAction(
  '[Chat] Send Message Failure',
  props<{ error: string }>()
);

// Excluir conversa
export const DeleteChat = createAction(
  '[Chat] Delete Chat',
  props<{ chatId: string }>()
);
export const DeleteChatSuccess = createAction(
  '[Chat] Delete Chat Success',
  props<{ chatId: string }>()
);
export const DeleteChatFailure = createAction(
  '[Chat] Delete Chat Failure',
  props<{ error: string }>()
);

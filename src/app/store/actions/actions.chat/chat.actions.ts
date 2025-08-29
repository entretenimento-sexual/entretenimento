// src/app/store/actions/actions.chat/chat.actions.ts
import { createAction, props } from '@ngrx/store';
import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { environment } from 'src/environments/environment';

// **Carregar conversas do usuário**
export const loadChats = createAction('[Chat] Load Chats');
export const loadChatsSuccess = createAction(
  '[Chat] Load Chats Success',
  props<{ chats: IChat[] }>()
);
export const loadChatsFailure = createAction(
  '[Chat] Load Chats Failure',
  props<{ error: string }>()
);

// **Criar uma nova conversa**
export const createChat = createAction(
  '[Chat] Create Chat',
  props<{ chat: IChat }>()
);
export const createChatSuccess = createAction(
  '[Chat] Create Chat Success',
  props<{ chat: IChat }>()
);
export const createChatFailure = createAction(
  '[Chat] Create Chat Failure',
  props<{ error: string }>()
);

// **Atualizar conversa**
export const updateChat = createAction(
  '[Chat] Update Chat',
  props<{ chatId: string; updateData: Partial<IChat> }>()
);
export const updateChatSuccess = createAction(
  '[Chat] Update Chat Success',
  props<{ chatId: string; updateData: Partial<IChat> }>()
);
export const updateChatFailure = createAction(
  '[Chat] Update Chat Failure',
  props<{ error: string }>()
);

// **Enviar mensagem em uma conversa**
export const sendMessage = createAction(
  '[Chat] Send Message',
  props<{ chatId: string; message: Message }>()
);
export const sendMessageSuccess = createAction(
  '[Chat] Send Message Success',
  props<{ chatId: string; message: Message }>()
);
export const sendMessageFailure = createAction(
  '[Chat] Send Message Failure',
  props<{ error: string }>()
);

// **Excluir uma conversa**
export const deleteChat = createAction(
  '[Chat] Delete Chat',
  props<{ chatId: string }>()
);
export const deleteChatSuccess = createAction(
  '[Chat] Delete Chat Success',
  props<{ chatId: string }>()
);
export const deleteChatFailure = createAction(
  '[Chat] Delete Chat Failure',
  props<{ error: string }>()
);

// **Monitorar uma conversa em tempo real**
export const monitorChat = createAction(
  '[Chat] Monitor Chat',
  props<{ chatId: string }>()
);
export const newMessageReceived = createAction(
  '[Chat] New Message Received',
  props<{ chatId: string; messages: Message[] }>()
);
export const monitorChatFailure = createAction(
  '[Chat] Monitor Chat Failure',
  props<{ error: string }>()
);

// **Gerenciamento de mensagens individuais**
export const addMessage = createAction(
  '[Chat] Add Message',
  props<{ chatId: string; message: Message }>()
);
export const addMessageSuccess = createAction(
  '[Chat] Add Message Success',
  props<{ chatId: string; message: Message }>()
);
export const addMessageFailure = createAction(
  '[Chat] Add Message Failure',
  props<{ error: string }>()
);

export const deleteMessage = createAction(
  '[Chat] Delete Message',
  props<{ chatId: string; messageId: string }>()
);
export const deleteMessageSuccess = createAction(
  '[Chat] Delete Message Success',
  props<{ chatId: string; messageId: string }>()
);
export const deleteMessageFailure = createAction(
  '[Chat] Delete Message Failure',
  props<{ error: string }>()
);

// **Adicionar participantes em um grupo**
export const addParticipants = createAction(
  '[Chat] Add Participants',
  props<{ chatId: string; participants: string[] }>()
);
export const addParticipantsSuccess = createAction(
  '[Chat] Add Participants Success',
  props<{ chatId: string; participants: string[] }>()
);
export const addParticipantsFailure = createAction(
  '[Chat] Add Participants Failure',
  props<{ error: string }>()
);

// **Remover participantes de um grupo**
export const removeParticipants = createAction(
  '[Chat] Remove Participants',
  props<{ chatId: string; participants: string[] }>()
);
export const removeParticipantsSuccess = createAction(
  '[Chat] Remove Participants Success',
  props<{ chatId: string; participants: string[] }>()
);
export const removeParticipantsFailure = createAction(
  '[Chat] Remove Participants Failure',
  props<{ error: string }>()
);

if (!environment.production) {
console.log('Ações de Chat carregadas:', {
  loadChats, loadChatsSuccess, loadChatsFailure,
  createChat, createChatSuccess, createChatFailure,
  updateChat, updateChatSuccess, updateChatFailure,
  sendMessage, sendMessageSuccess, sendMessageFailure,
  deleteChat, deleteChatSuccess, deleteChatFailure,
  monitorChat, newMessageReceived, monitorChatFailure,
  addMessage, addMessageSuccess, addMessageFailure,
  deleteMessage, deleteMessageSuccess, deleteMessageFailure,
  addParticipants, addParticipantsSuccess, addParticipantsFailure,
  removeParticipants, removeParticipantsSuccess, removeParticipantsFailure,
});
}

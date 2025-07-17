// src/app/store/reducers/reducers.chat/chat.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { ChatState } from '../../states/states.chat/chat.state';
import * as ChatActions from '../../actions/actions.chat/chat.actions';

export const initialState: ChatState = {
  chats: [],
  loading: false,
  error: null,
  messages: {}
};

/**
 * Chat reducer para gerenciar o estado das conversas.
 * Inicializa com o estado inicial e lida com cada ação usando handlers específicos.
 */
export const chatReducer = createReducer<ChatState>(
  initialState,  // Aplica o initialState corretamente

  /**
   * Inicia o carregamento das conversas do usuário.
   * Define `loading` como `true` para indicar o início do processo.
   */
  on(ChatActions.loadChats, (state) => {
    console.log('[ChatReducer] Ação loadChats iniciada');
    return {
      ...state,
      loading: true,
      error: null
    };
  }),

  /**
   * Sucesso no carregamento das conversas.
   * Armazena as conversas no estado e redefine `loading` para `false`.
   */
  on(ChatActions.loadChatsSuccess, (state, { chats }) => {
    console.log('[ChatReducer] Ação loadChatsSuccess executada', chats);
    return {
      ...state,
      chats,
      loading: false
    };
  }),

  /**
   * Falha no carregamento das conversas.
   * Define `loading` como `false` e armazena o erro.
   */
  on(ChatActions.loadChatsFailure, (state, { error }) => {
    console.log('[ChatReducer] Ação loadChatsFailure executada. Erro:', error);
    return {
      ...state,
      loading: false,
      error
    };
  }),

  /**
   * Envio de mensagem em uma conversa.
   * Adiciona a mensagem ao array de mensagens do `chatId` correspondente.
   */
  on(ChatActions.sendMessage, (state, { chatId, message }) => {
    console.log('[ChatReducer] Ação sendMessage executada para chatId:', chatId, 'Mensagem:', message);
    return {
      ...state,
      messages: {
        ...state.messages,
        [chatId]: [...(state.messages[chatId] || []), message]
      }
    };
  }),

  /**
   * Início da criação de uma nova conversa.
   * Define `loading` como `true` para indicar o processo de criação.
   */
  on(ChatActions.createChat, (state) => {
    console.log('[ChatReducer] Ação createChat iniciada');
    return {
      ...state,
      loading: true
    };
  }),

  /**
   * Sucesso na criação de uma nova conversa.
   * Adiciona a nova conversa ao array de conversas no estado.
   */
  on(ChatActions.createChatSuccess, (state, { chat }) => {
    console.log('[ChatReducer] Ação createChatSuccess executada', chat);
    return {
      ...state,
      chats: [...state.chats, chat],
      loading: false
    };
  }),

  /**
   * Falha ao criar uma nova conversa.
   * Define `loading` como `false` e armazena o erro.
   */
  on(ChatActions.createChatFailure, (state, { error }) => {
    console.log('[ChatReducer] Ação createChatFailure executada. Erro:', error);
    return {
      ...state,
      loading: false,
      error
    };
  }),

  /**
   * Exclusão de uma conversa.
   * Remove a conversa pelo `chatId` e registra o processo.
   */
  on(ChatActions.deleteChatSuccess, (state, { chatId }) => {
    console.log('[ChatReducer] Ação deleteChatSuccess executada para chatId:', chatId);
    return {
      ...state,
      chats: state.chats.filter(chat => chat.id !== chatId),
      loading: false
    };
  }),

  /**
   * Falha ao excluir uma conversa.
   * Define `loading` como `false` e armazena o erro.
   */
  on(ChatActions.deleteChatFailure, (state, { error }) => {
    console.log('[ChatReducer] Ação deleteChatFailure executada. Erro:', error);
    return {
      ...state,
      loading: false,
      error
    };
  })
);

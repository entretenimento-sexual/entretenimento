// src/app/store/reducers/reducers.chat/chat.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { initialChatState, ChatState } from '../../states/states.chat/chat.state';
import * as ChatActions from '../../actions/actions.chat/chat.actions';

export const chatReducer = createReducer<ChatState>(
  initialChatState,

  on(ChatActions.LoadChats, (state) => {
    console.log('Ação LoadChats iniciada');
    return {
      ...state,
      loading: true,
      error: null
    };
  }),

  on(ChatActions.LoadChatsSuccess, (state, { chats }) => {
    console.log('Ação LoadChatsSuccess executada', chats);
    return {
      ...state,
      chats,
      loading: false
    };
  }),

  on(ChatActions.LoadChatsFailure, (state, { error }) => {
    console.log('Ação LoadChatsFailure executada', error);
    return {
      ...state,
      loading: false,
      error
    };
  }),

  on(ChatActions.SendMessage, (state, { chatId, message }) => {
    console.log('Ação SendMessage executada', { chatId, message });
    return {
      ...state,
      messages: {
        ...state.messages,
        [chatId]: [...(state.messages[chatId] || []), message]
      }
    };
  }),

  on(ChatActions.CreateChat, (state) => {
    console.log('Ação CreateChat iniciada');
    return {
      ...state,
      loading: true
    };
  }),

  on(ChatActions.CreateChatSuccess, (state, { chat }) => {
    console.log('Ação CreateChatSuccess executada', chat);
    return {
      ...state,
      chats: [...state.chats, chat],
      loading: false
    };
  })
);

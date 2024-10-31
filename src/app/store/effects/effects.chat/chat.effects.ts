// src/app/store/effects/effects.chat/chat.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { ChatService } from 'src/app/core/services/batepapo/chat.service';
import * as ChatActions from '../../actions/actions.chat/chat.actions';
import { map, mergeMap, catchError } from 'rxjs/operators';
import { of, from } from 'rxjs';

@Injectable()
export class ChatEffects {
  constructor(
    private actions$: Actions,
    private chatService: ChatService
  ) { }

  loadChats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.LoadChats),
      mergeMap(() => {
        console.log('Ação LoadChats detectada.');
        const userId = 'USER_ID_ATUAL'; // Substitua com o método para obter o ID do usuário atual
        return this.chatService.getChats(userId).pipe(
          map(chats => {
            console.log('Chats carregados com sucesso:', chats);
            return ChatActions.LoadChatsSuccess({ chats });
          }),
          catchError(error => {
            console.error('Erro ao carregar chats:', error);
            return of(ChatActions.LoadChatsFailure({ error: error.message || 'Erro desconhecido' }));
          })
        );
      })
    )
  );

  createChat$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.CreateChat),
      mergeMap(action => {
        console.log('Ação CreateChat detectada com participantes:', action.chat.participants);
        return from(this.chatService.createChat(action.chat.participants)).pipe(
          map(chatId => {
            console.log('Chat criado com sucesso com ID:', chatId);
            return ChatActions.CreateChatSuccess({ chat: { ...action.chat, id: chatId } });
          }),
          catchError(error => {
            console.error('Erro ao criar chat:', error);
            return of(ChatActions.CreateChatFailure({ error: error.message || 'Erro ao criar chat' }));
          })
        );
      })
    )
  );

  sendMessage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.SendMessage),
      mergeMap(action => {
        console.log('Ação SendMessage detectada para chatId:', action.chatId);
        return from(this.chatService.sendMessage(action.chatId, action.message)).pipe(
          map(() => {
            console.log('Mensagem enviada com sucesso:', action.message);
            return ChatActions.SendMessageSuccess({ message: action.message });
          }),
          catchError(error => {
            console.error('Erro ao enviar mensagem:', error);
            return of(ChatActions.SendMessageFailure({ error: error.message || 'Erro ao enviar mensagem' }));
          })
        );
      })
    )
  );

  deleteChat$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.DeleteChat),
      mergeMap(action => {
        console.log('Ação DeleteChat detectada para chatId:', action.chatId);
        return from(this.chatService.deleteChat(action.chatId)).pipe(
          map(() => {
            console.log('Chat deletado com sucesso para chatId:', action.chatId);
            return ChatActions.DeleteChatSuccess({ chatId: action.chatId });
          }),
          catchError(error => {
            console.error('Erro ao deletar chat:', error);
            return of(ChatActions.DeleteChatFailure({ error: error.message || 'Erro ao deletar chat' }));
          })
        );
      })
    )
  );
}

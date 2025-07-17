// src/app/store/effects/effects.chat/chat.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import * as ChatActions from '../../actions/actions.chat/chat.actions';
import { map, switchMap, mergeMap, catchError, withLatestFrom, tap } from 'rxjs/operators';
import { of, from } from 'rxjs';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { environment } from '../../../../environments/environment';

@Injectable()
export class ChatEffects {
  constructor(
    private actions$: Actions,
    private chatService: ChatService,
    private authService: AuthService,
    private errorNotificationService: ErrorNotificationService,
    private store: Store<AppState>
  ) { }

  loadChats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.loadChats),
      withLatestFrom(this.authService.user$),
      switchMap(([action, user]: [any, IUserDados | null]) => {
        if (!user) {
          if (!environment.production) {
            console.log('[ChatEffects] Nenhum usuário autenticado encontrado.');
          }
          return of(ChatActions.loadChatsFailure({ error: 'Usuário não autenticado' }));
        }
        if (!environment.production) {
          console.log('[ChatEffects] Carregando chats para o usuário:', user.uid);
        }
        return this.chatService.getChats(user.uid).pipe(
          map(chats => ChatActions.loadChatsSuccess({ chats })),
          catchError(error => {
            this.errorNotificationService.showError('Erro ao carregar chats');
            if (!environment.production) {
              console.log('[ChatEffects] Erro ao carregar chats:', error);
            }
            return of(ChatActions.loadChatsFailure({ error: error.message || 'Erro desconhecido' }));
          })
        );
      })
    )
  );

  createChat$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.createChat),
      mergeMap(action => {
        if (!environment.production) {
          console.log('[ChatEffects] Iniciando criação do chat com participantes:', action.chat.participants);
        }
        return from(this.chatService.createChat(action.chat.participants)).pipe(
          map(chatId => ChatActions.createChatSuccess({ chat: { ...action.chat, id: chatId } })),
          catchError(error => {
            this.errorNotificationService.showError('Erro ao criar chat');
            if (!environment.production) {
              console.log('[ChatEffects] Erro ao criar chat:', error);
            }
            return of(ChatActions.createChatFailure({ error: error.message || 'Erro ao criar chat' }));
          })
        );
      })
    )
  );

  sendMessage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.sendMessage),
      mergeMap(action => {
        if (!environment.production) {
          console.log(`[ChatEffects] Enviando mensagem para o chat ${action.chatId}`);
        }
        return from(this.chatService.sendMessage(action.chatId, action.message, action.message.senderId)).pipe(
          map(() => ChatActions.sendMessageSuccess({ chatId: action.chatId, message: action.message })),
          catchError(error => {
            this.errorNotificationService.showError('Erro ao enviar mensagem');
            if (!environment.production) {
              console.log('[ChatEffects] Erro ao enviar mensagem:', error);
            }
            return of(ChatActions.sendMessageFailure({ error: error.message || 'Erro ao enviar mensagem' }));
          })
        );
      })
    )
  );

  deleteChat$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.deleteChat),
      mergeMap(action => {
        if (!environment.production) {
          console.log(`[ChatEffects] Deletando o chat ${action.chatId}`);
        }
        return from(this.chatService.deleteChat(action.chatId)).pipe(
          map(() => ChatActions.deleteChatSuccess({ chatId: action.chatId })),
          catchError(error => {
            this.errorNotificationService.showError('Erro ao deletar chat');
            if (!environment.production) {
              console.log('[ChatEffects] Erro ao deletar chat:', error);
            }
            return of(ChatActions.deleteChatFailure({ error: error.message || 'Erro ao deletar chat' }));
          })
        );
      })
    )
  );

  deleteMessage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.deleteMessage),
      mergeMap(action => {
        if (!environment.production) {
          console.log(`[ChatEffects] Deletando mensagem ${action.messageId} no chat ${action.chatId}`);
        }
        return from(this.chatService.deleteMessage(action.chatId, action.messageId)).pipe(
          map(() => ChatActions.deleteMessageSuccess({ chatId: action.chatId, messageId: action.messageId })),
          catchError(error => {
            this.errorNotificationService.showError('Erro ao deletar mensagem');
            if (!environment.production) {
              console.log('[ChatEffects] Erro ao deletar mensagem:', error);
            }
            return of(ChatActions.deleteMessageFailure({ error: error.message || 'Erro ao deletar mensagem' }));
          })
        );
      })
    )
  );

  monitorChat$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.monitorChat),
      mergeMap(action =>
        this.chatService.monitorChat(action.chatId).pipe(
          map(messages => ChatActions.newMessageReceived({ chatId: action.chatId, messages })),
          catchError(error => {
            this.errorNotificationService.showError('Erro ao monitorar chat');
            if (!environment.production) {
              console.log('[ChatEffects] Erro ao monitorar chat:', error);
            }
            return of(ChatActions.monitorChatFailure({ error: error.message || 'Erro ao monitorar chat' }));
          })
        )
      )
    )
  );
}

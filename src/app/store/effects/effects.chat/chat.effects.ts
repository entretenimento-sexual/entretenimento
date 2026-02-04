// src/app/store/effects/effects.chat/chat.effects.ts
// Não esqueça os comentários
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';

import * as ChatActions from '../../actions/actions.chat/chat.actions';

import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { environment } from '../../../../environments/environment';

import { of, from } from 'rxjs';
import { catchError, concatMap, filter, map, mergeMap, switchMap, takeUntil, tap } from 'rxjs/operators';
import { concatLatestFrom } from '@ngrx/operators';

@Injectable()
export class ChatEffects {
  // Evita marcar delivered repetidamente pro mesmo (chatId:messageId)
  private readonly deliveredOnce = new Set<string>();

  constructor(
    private readonly actions$: Actions,
    private readonly chatService: ChatService,
    private readonly authSession: AuthSessionService,
    private readonly notify: ErrorNotificationService,
    private readonly store: Store<AppState>
  ) { }

  /**
   * Helper: evita toast duplicado quando o ChatService já mostrou (uiShown=true).
   */
  private showIfNotShown(err: any, msg: string): void {
    if (err?.uiShown) return;
    this.notify.showError(msg);
  }

  // ---------------------------------------------------------------------------
  // Legado: loadChats -> watchChatsRequested
  // ---------------------------------------------------------------------------
  loadChats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.loadChats),
      concatLatestFrom(() => this.authSession.uid$),
      map(([_, uid]) => {
        if (!uid) return ChatActions.loadChatsFailure({ error: 'Usuário não autenticado' });
        return ChatActions.watchChatsRequested({ uid });
      })
    )
  );

  // ---------------------------------------------------------------------------
  // Realtime: chats → store
  // - start: watchChatsRequested
  // - stop : watchChatsStopped
  // ---------------------------------------------------------------------------
  watchChats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.watchChatsRequested),
      concatLatestFrom(({ uid }) => (uid ? of(uid) : this.authSession.uid$)),
      switchMap(([{ uid }, resolvedUid]) => {
        const finalUid = (resolvedUid ?? '').toString().trim();
        if (!finalUid) {
          return of(ChatActions.loadChatsFailure({ error: 'Usuário não autenticado' }));
        }

        if (!environment.production) {
          console.log('[ChatEffects] watchChats$ uid=', finalUid);
        }

        return this.chatService.watchChats$(finalUid, 10).pipe(
          map(chats => ChatActions.loadChatsSuccess({ chats })),
          catchError((err) => {
            this.showIfNotShown(err, 'Erro ao carregar chats');
            if (!environment.production) console.log('[ChatEffects] watchChats$ error:', err);
            return of(ChatActions.loadChatsFailure({ error: err?.message || 'Erro desconhecido' }));
          }),
          takeUntil(this.actions$.pipe(ofType(ChatActions.watchChatsStopped)))
        );
      })
    )
  );

  // ---------------------------------------------------------------------------
  // CRUD (sem loops, pois ChatService não despacha mais)
  // ---------------------------------------------------------------------------
  createChat$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.createChat),
      mergeMap(({ chat }) => {
        if (!environment.production) {
          console.log('[ChatEffects] createChat participants:', chat?.participants);
        }

        return this.chatService.createChat(chat.participants).pipe(
          map(chatId => ChatActions.createChatSuccess({ chat: { ...chat, id: chatId } as any })),
          catchError((err) => {
            this.showIfNotShown(err, 'Erro ao criar chat');
            if (!environment.production) console.log('[ChatEffects] createChat$ error:', err);
            return of(ChatActions.createChatFailure({ error: err?.message || 'Erro ao criar chat' }));
          })
        );
      })
    )
  );

  updateChat$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.updateChat),
      mergeMap(({ chatId, updateData }) =>
        this.chatService.updateChat(chatId, updateData).pipe(
          map(() => ChatActions.updateChatSuccess({ chatId, updateData })),
          catchError((err) => {
            this.showIfNotShown(err, 'Erro ao atualizar conversa');
            return of(ChatActions.updateChatFailure({ error: err?.message || 'Erro ao atualizar conversa' }));
          })
        )
      )
    )
  );

  sendMessage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.sendMessage),
      mergeMap(({ chatId, message }) =>
        this.chatService.sendMessage(chatId, message, message.senderId).pipe(
          map(() => ChatActions.sendMessageSuccess({ chatId, message })),
          catchError((err) => {
            this.showIfNotShown(err, 'Erro ao enviar mensagem');
            return of(ChatActions.sendMessageFailure({ error: err?.message || 'Erro ao enviar mensagem' }));
          })
        )
      )
    )
  );

  deleteChat$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.deleteChat),
      mergeMap(({ chatId }) =>
        this.chatService.deleteChat(chatId).pipe(
          map(() => ChatActions.deleteChatSuccess({ chatId })),
          catchError((err) => {
            this.showIfNotShown(err, 'Erro ao deletar chat');
            return of(ChatActions.deleteChatFailure({ error: err?.message || 'Erro ao deletar chat' }));
          })
        )
      )
    )
  );

  deleteMessage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.deleteMessage),
      mergeMap(({ chatId, messageId }) =>
        this.chatService.deleteMessage(chatId, messageId).pipe(
          map(() => ChatActions.deleteMessageSuccess({ chatId, messageId })),
          catchError((err) => {
            this.showIfNotShown(err, 'Erro ao deletar mensagem');
            return of(ChatActions.deleteMessageFailure({ error: err?.message || 'Erro ao deletar mensagem' }));
          })
        )
      )
    )
  );

  // ---------------------------------------------------------------------------
  // Legado: monitorChat -> watchMessagesRequested
  // ---------------------------------------------------------------------------
  monitorChat$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.monitorChat),
      map(({ chatId }) => ChatActions.watchMessagesRequested({ chatId }))
    )
  );

  // ---------------------------------------------------------------------------
  // Realtime: messages → store (newMessageReceived)
  // - start: watchMessagesRequested
  // - stop : watchMessagesStopped (por chat)
  // ---------------------------------------------------------------------------
  watchMessages$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.watchMessagesRequested),
      mergeMap(({ chatId }) => {
        const cid = (chatId ?? '').toString().trim();
        if (!cid) {
          return of(ChatActions.monitorChatFailure({ error: 'chatId inválido' }));
        }

        if (!environment.production) {
          console.log('[ChatEffects] watchMessages$ chatId=', cid);
        }

        return this.chatService.monitorChat(cid).pipe(
          map((messages) => ChatActions.newMessageReceived({ chatId: cid, messages })),
          catchError((err) => {
            this.showIfNotShown(err, 'Erro ao monitorar chat');
            return of(ChatActions.monitorChatFailure({ error: err?.message || 'Erro ao monitorar chat' }));
          }),
          takeUntil(
            this.actions$.pipe(
              ofType(ChatActions.watchMessagesStopped),
              // ✅ corrige seu erro 7006: tipa o parâmetro do filter
              filter((a: { chatId: string }) => a.chatId === cid)
            )
          )
        );
      })
    )
  );

  // ---------------------------------------------------------------------------
  // Side-effect: marcar mensagens recebidas como delivered (dispatch:false)
  // ---------------------------------------------------------------------------
  markDelivered$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.newMessageReceived),
      concatLatestFrom(() => this.authSession.uid$),
      mergeMap(([{ chatId, messages }, loggedUid]) => {
        if (!loggedUid) return of(void 0);

        const toMark = (messages ?? [])
          .map(m => ({ m, id: (m as any).id as string | undefined }))
          .filter(x =>
            !!x.id &&
            x.m.status === 'sent' &&
            x.m.senderId &&
            x.m.senderId !== loggedUid &&
            !this.deliveredOnce.has(`${chatId}:${x.id}`)
          );

        if (!toMark.length) return of(void 0);

        return from(toMark).pipe(
          concatMap(({ id }) => {
            const key = `${chatId}:${id}`;
            this.deliveredOnce.add(key);

            return this.chatService.updateMessageStatus(chatId, id!, 'delivered').pipe(
              catchError((err) => {
                // best-effort: não derruba stream
                if (!environment.production) console.log('[ChatEffects] markDelivered$ error:', err);
                return of(void 0);
              })
            );
          })
        );
      })
    ),
    { dispatch: false }
  );

  // ---------------------------------------------------------------------------
  // Limpa deliveredOnce do chat parado (evita crescimento infinito)
  // ---------------------------------------------------------------------------
  clearDeliveredOnce$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChatActions.watchMessagesStopped),
      tap(({ chatId }) => {
        const prefix = `${chatId}:`;
        for (const k of Array.from(this.deliveredOnce)) {
          if (k.startsWith(prefix)) this.deliveredOnce.delete(k);
        }
      })
    ),
    { dispatch: false }
  );
}

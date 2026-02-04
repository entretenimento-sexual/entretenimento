// src/app/core/services/batepapo/chat-service/chat.service.ts
// Serviço de Bate-Papo (domínio) usando Firestore
// =============================================================================
// OBJETIVO:
// - Service de domínio: NÃO despacha NgRx, NÃO é dono da Store.
// - Realtime → Store fica em Effects (watchChats$, watchMessages$).
// - Gating de sessão continua aqui (ready/auth/block/emailVerified).
// - Erros: globalError (silent) + notify só em validações de UX (ex: msg vazia).
// =============================================================================

import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, combineLatest, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs/operators';

import { Timestamp } from 'firebase/firestore';

import { IChat } from '@core/interfaces/interfaces-chat/chat.interface';
import { Message } from '@core/interfaces/interfaces-chat/message.interface';

import { CacheService } from '@core/services/general/cache/cache.service';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { AuthAppBlockService } from '@core/services/autentication/auth/auth-app-block.service';

import { ChatRepository } from '@core/services/data-handling/firestore/repositories/chat.repository';
import { ChatMessagesRepository } from '@core/services/data-handling/firestore/repositories/chat-messages.repository';

import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

// ✅ garanta que esse import aponta para o DONO real (o service que você ajustou pra ser owner do getUser$)


import { ChatPolicyService } from './chat-policy.service';
import { UserRepositoryService } from '../../data-handling/firestore/repositories/user-repository.service';

@Injectable({ providedIn: 'root' })
export class ChatService implements OnDestroy {
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly appBlock: AuthAppBlockService,

    private readonly cache: CacheService,
    private readonly userRepo: UserRepositoryService,

    private readonly policy: ChatPolicyService,
    private readonly chatsRepo: ChatRepository,
    private readonly msgsRepo: ChatMessagesRepository,

    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
  ) { }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * reportSilent:
   * - Envia para GlobalErrorHandlerService com "silent=true"
   * - Não exibe toast automaticamente (o Effect decide)
   */
  private reportSilent(action: string, err: unknown): Observable<never> {
    const e = err instanceof Error ? err : new Error(`[ChatService] ${action}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = { action };
    this.globalError.handleError(e);
    return throwError(() => e);
  }

  /**
   * failUi:
   * - Para validações UX (ex: mensagem vazia), mostra toast aqui
   * - Marca uiShown=true para Effects evitarem toast duplicado
   */
  private failUi(action: string, userMsg: string, err: unknown): Observable<never> {
    this.notify.showError(userMsg);
    const e = err instanceof Error ? err : new Error(String(err));
    (e as any).uiShown = true;
    return this.reportSilent(action, e);
  }

  /**
   * canListen$:
   * - Regras “cliente” para habilitar listeners.
   * - A decisão final sempre deve ser reforçada em Rules/CF.
   */
  private readonly canListen$ = combineLatest([
    this.authSession.ready$,
    this.authSession.authUser$,
    this.appBlock.reason$,
  ]).pipe(
    map(([ready, user, blocked]) => {
      if (!ready) return false;
      if (!user?.uid) return false;
      if (blocked) return false;
      if (user.emailVerified !== true) return false;
      return true;
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private requireUidOnce$(): Observable<string> {
    return combineLatest([this.authSession.ready$, this.authSession.uid$, this.appBlock.reason$]).pipe(
      take(1),
      switchMap(([ready, uid, blocked]) => {
        if (!ready) return this.reportSilent('requireUidOnce$ - not ready', new Error('Sessão não pronta'));
        if (blocked) return this.reportSilent('requireUidOnce$ - blocked', new Error('App bloqueado'));
        if (!uid) return this.reportSilent('requireUidOnce$ - no uid', new Error('Não autenticado'));
        return of(uid);
      })
    );
  }

  // ===========================================================================
  // CHAT ID
  // ===========================================================================
  getOrCreateChatId(participants: string[]): Observable<string> {
    const ids = Array.from(new Set((participants ?? []).map(x => (x ?? '').toString().trim()).filter(Boolean)));
    if (ids.length < 2) {
      return this.failUi('getOrCreateChatId', 'Não foi possível iniciar o chat.', new Error('Participantes inválidos'));
    }

    const participantsKey = [...ids].sort().join('_');
    const cacheKey = `chatId:${participantsKey}`;

    return this.cache.get<string>(cacheKey).pipe(
      take(1),
      switchMap(cached => {
        if (cached) return of(cached);

        return this.chatsRepo.findChatIdByParticipantsKey$(participantsKey).pipe(
          switchMap(existingId => {
            if (existingId) {
              this.cache.set(cacheKey, existingId);
              return of(existingId);
            }
            return this.createChat(ids).pipe(
              tap(newId => this.cache.set(cacheKey, newId))
            );
          })
        );
      }),
      catchError(err => this.reportSilent('getOrCreateChatId', err))
    );
  }

  // ===========================================================================
  // CRUD Chat (sem dispatch NgRx)
  // ===========================================================================
  createChat(participants: string[]): Observable<string> {
    const ids = Array.from(new Set((participants ?? []).map(x => (x ?? '').toString().trim()).filter(Boolean)));
    if (ids.length < 2) {
      return this.failUi('createChat', 'Não foi possível criar o chat agora.', new Error('Participantes inválidos'));
    }

    const participantsKey = [...ids].sort().join('_');

    return this.chatsRepo.createChat$(ids, participantsKey).pipe(
      catchError(err => this.reportSilent('createChat', err))
    );
  }

  updateChat(chatId: string, updateData: Partial<IChat>): Observable<string> {
    const id = (chatId ?? '').toString().trim();
    if (!id) return this.reportSilent('updateChat', new Error('chatId inválido'));

    return this.chatsRepo.updateChat$(id, updateData).pipe(
      map(() => id),
      catchError(err => this.reportSilent('updateChat', err))
    );
  }

  deleteChat(chatId: string): Observable<void> {
    const id = (chatId ?? '').toString().trim();
    if (!id) return this.reportSilent('deleteChat', new Error('chatId inválido'));

    return this.chatsRepo.deleteChat$(id).pipe(
      catchError(err => this.reportSilent('deleteChat', err))
    );
  }

  deleteMessage(chatId: string, messageId: string): Observable<void> {
    const cid = (chatId ?? '').toString().trim();
    const mid = (messageId ?? '').toString().trim();
    if (!cid || !mid) return this.reportSilent('deleteMessage', new Error('ids inválidos'));

    return this.msgsRepo.deleteMessage$(cid, mid).pipe(
      catchError(err => this.reportSilent('deleteMessage', err))
    );
  }

  // ===========================================================================
  // Participant details (usa o DONO do getUser$)
  // ===========================================================================
  fetchAndPersistParticipantDetails(chatId: string, participantUid: string): Observable<IChat | null> {
    const uid = (participantUid ?? '').toString().trim();
    const cid = (chatId ?? '').toString().trim();
    if (!uid || !cid) return of(null);

    return this.userRepo.getUser$(uid).pipe(
      take(1),
      switchMap(user => {
        if (!user) return of(null);
        return this.updateChat(cid, { otherParticipantDetails: user } as any).pipe(
          map(() => null)
        );
      }),
      catchError(err => this.reportSilent('fetchAndPersistParticipantDetails', err))
    );
  }

  refreshParticipantDetailsIfNeeded(chatId: string): void {
    const cid = (chatId ?? '').toString().trim();
    if (!cid) return;

    this.cache.get<IChat>(`chat:${cid}`).pipe(
      take(1),
      switchMap(chat => {
        if (!chat || (chat as any).otherParticipantDetails) return of(null);

        return this.requireUidOnce$().pipe(
          switchMap(loggedUid => {
            const otherUid = chat.participants?.find(u => u !== loggedUid);
            return otherUid ? this.fetchAndPersistParticipantDetails(cid, otherUid) : of(null);
          })
        );
      }),
      catchError(() => of(null))
    ).subscribe();
  }

  // ===========================================================================
  // Mensagens (sem dispatch NgRx)
  // ===========================================================================
  sendMessage(chatId: string, message: Message, senderId: string): Observable<string> {
    const cid = (chatId ?? '').toString().trim();
    if (!cid) return this.reportSilent('sendMessage', new Error('chatId inválido'));

    const content = (message?.content ?? '').toString().trim();
    if (!content) {
      return this.failUi('sendMessage', 'A mensagem não pode ser vazia.', new Error('Mensagem vazia'));
    }

    return this.requireUidOnce$().pipe(
      switchMap(loggedUid => {
        if (!senderId || senderId !== loggedUid) {
          return this.failUi('sendMessage', 'Não foi possível enviar a mensagem.', new Error('senderId divergente'));
        }

        return this.policy.canSendMessage$(content).pipe(
          take(1),
          switchMap(decision => {
            if (!decision.canSend) {
              return this.failUi(
                'sendMessage.policy',
                decision.reason || 'Você não pode enviar mensagens agora.',
                new Error(decision.reason || 'blocked')
              );
            }

            return this.userRepo.getUser$(senderId).pipe(
              take(1),
              switchMap(user => {
                if (!user) {
                  return this.failUi('sendMessage.user', 'Não foi possível enviar a mensagem.', new Error('Usuário não encontrado'));
                }

                const now = Timestamp.now();

                const msgToSend: Message = {
                  ...message,
                  content,
                  senderId,
                  nickname: (user as any).nickname || 'Anônimo',
                  timestamp: now,
                  status: 'sent',
                };

                // compat/auditoria
                (msgToSend as any).senderUid = senderId;
                (msgToSend as any).createdAt = now;

                return this.msgsRepo.addMessage$(cid, msgToSend).pipe(
                  switchMap(messageId => {
                    const chatPatch: Partial<IChat> = {
                      lastMessage: {
                        content: msgToSend.content,
                        nickname: msgToSend.nickname,
                        senderId: msgToSend.senderId,
                        timestamp: msgToSend.timestamp,
                      } as any
                    };

                    return this.updateChat(cid, chatPatch).pipe(
                      map(() => messageId)
                    );
                  })
                );
              })
            );
          })
        );
      }),
      catchError(err => this.reportSilent('sendMessage', err))
    );
  }

  getMessages(chatId: string, lastMessageTimestamp?: Timestamp): Observable<Message[]> {
    const cid = (chatId ?? '').toString().trim();
    if (!cid) return of([]);
    return this.msgsRepo.getMessagesPageOnce$(cid, lastMessageTimestamp, 20).pipe(
      catchError(err => this.reportSilent('getMessages', err))
    );
  }

  /**
   * monitorChat:
   * - Agora é SOMENTE stream realtime (sem delivered aqui).
   * - delivered/read vira side-effect no Effect (dispatch:false).
   */
  monitorChat(chatId: string): Observable<Message[]> {
    const cid = (chatId ?? '').toString().trim();
    if (!cid) return of([]);

    return this.canListen$.pipe(
      switchMap(canListen => {
        if (!canListen) return of([] as Message[]);
        return this.msgsRepo.watchMessages$(cid, 200);
      }),
      catchError(err => this.reportSilent('monitorChat', err))
    );
  }

  updateMessageStatus(chatId: string, messageId: string, status: 'sent' | 'delivered' | 'read'): Observable<void> {
    const cid = (chatId ?? '').toString().trim();
    const mid = (messageId ?? '').toString().trim();
    if (!cid || !mid) return this.reportSilent('updateMessageStatus', new Error('ids inválidos'));

    return this.msgsRepo.updateMessageStatus$(cid, mid, status).pipe(
      catchError(err => this.reportSilent('updateMessageStatus', err))
    );
  }

  // ===========================================================================
  // Realtime Chats (para Effects)
  // ===========================================================================
  /**
   * watchChats$(uid):
   * - Stream realtime das conversas do usuário.
   * - NÃO usa cache “stale” (diferente do getChats()).
   * - Effects controla start/stop (takeUntil).
   */
  watchChats$(uid: string, limit = 10): Observable<IChat[]> {
    const id = (uid ?? '').toString().trim();
    if (!id) return of([]);

    return this.canListen$.pipe(
      switchMap(canListen => {
        if (!canListen) return of([] as IChat[]);
        return this.chatsRepo.watchChats$(id, limit);
      }),
      catchError(err => this.reportSilent('watchChats$', err))
    );
  }

  /**
   * getChats:
   * - Mantido por compat.
   * - Pode devolver cache e/ou paginação.
   * - Para realtime em Store, prefira watchChats$ nos Effects.
   */
  getChats(userId: string, lastChatTimestamp?: Timestamp): Observable<IChat[]> {
    const uid = (userId ?? '').toString().trim();
    if (!uid) return of([]);

    const cacheKey = `chats:${uid}`;

    return this.cache.get<IChat[]>(cacheKey).pipe(
      take(1),
      switchMap(cached => {
        if (!lastChatTimestamp && cached?.length) return of(cached);

        return this.canListen$.pipe(
          take(1),
          switchMap(canListen => {
            if (!lastChatTimestamp && canListen) {
              return this.chatsRepo.watchChats$(uid, 10).pipe(
                tap(list => this.cache.set(cacheKey, list))
              );
            }

            return this.chatsRepo.getChatsPageOnce$(uid, lastChatTimestamp, 10).pipe(
              tap(list => this.cache.set(cacheKey, list))
            );
          })
        );
      }),
      catchError(err => this.reportSilent('getChats', err))
    );
  }
}

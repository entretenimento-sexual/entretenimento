// src/app/core/services/batepapo/chat-service/chat.service.ts
// Serviço de Bate-Papo (domínio) usando Firestore
// =============================================================================
// OBJETIVO:
// - Service de domínio: NÃO despacha NgRx, NÃO é dono da Store.
// - Realtime → Store fica em Effects (watchChats$, watchMessages$).
// - Gating de sessão continua aqui (ready/auth/block/emailVerified).
// - Erros: ApplicationErrorService centraliza diagnóstico e apresentação declarativa.
// =============================================================================
import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, combineLatest, defer, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
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

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';


@Injectable({ providedIn: 'root' })
export class ChatService implements OnDestroy {
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly appBlock: AuthAppBlockService,

    private readonly cache: CacheService,
    private readonly chatsRepo: ChatRepository,
    private readonly msgsRepo: ChatMessagesRepository,

    private readonly applicationError: ApplicationErrorService,
  ) { }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * reportSilent:
   * - Registra diagnóstico técnico pelo ApplicationErrorService.
   * - Mantém surface=none para o chamador decidir eventual feedback de UX.
   * - Marca o Error para evitar diagnóstico duplicado em catches aninhados.
   */
  private reportSilent(action: string, err: unknown): Observable<never> {
    const error = this.asChatError(action, err);

    if (!(error as any).chatApplicationErrorReported) {
      this.applicationError.report(error, {
        feature: 'chat',
        operation: action,
        fallbackMessage:
          'Não foi possível concluir uma operação interna do chat.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'ChatService',
          action,
        },
      });
      (error as any).chatApplicationErrorReported = true;
    }

    return throwError(() => error);
  }

  private asChatError(action: string, err: unknown): Error {
    if (err instanceof Error) {
      return err;
    }

    const error = new Error(`[ChatService] ${action}`);
    (error as any).original = err;
    return error;
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

  /**
   * Escritas iniciadas pela sessão anterior não podem gerar resultados ou
   * diagnósticos na sessão seguinte. O cancelamento é lógico: a autorização
   * da gravação já enviada continua sob controle das Firestore Rules.
   */
  private sessionBoundWrite$(
    ownerUid: string,
    write$: Observable<void>
  ): Observable<void> {
    return write$.pipe(
      takeUntil(combineLatest([
        this.authSession.ready$,
        this.authSession.uid$,
        this.appBlock.reason$,
      ]).pipe(
        filter(([ready, uid, blocked]) => !ready || uid !== ownerUid || !!blocked)
      ))
    );
  }

  /**
   * Operações legadas de escrita não podem consultar o cache de outro UID,
   * ler dados privados nem tentar writes rejeitadas pelas Firestore Rules.
   * A autoridade para criar/recuperar um par é ensureDirectChat, consumida
   * por DirectChatService/DirectChatFacade; editar o chat exige backend.
   */
  private rejectLegacyChatOperation$<T>(operation: string): Observable<T> {
    return defer(() => {
      const error = new Error(
        'Operação do chat legado indisponível; use o fluxo canônico de conversa direta.'
      ) as Error & { code: string };
      error.code = 'failed-precondition';
      return this.reportSilent(operation, error);
    });
  }

  /** @deprecated Use DirectChatFacade.openChatWithUser$. */
  getOrCreateChatId(_participants: string[]): Observable<string> {
    return this.rejectLegacyChatOperation$('getOrCreateChatId');
  }

  /** @deprecated Use DirectChatService.ensureDirectChatIdWithUser$. */
  createChat(_participants: string[]): Observable<string> {
    return this.rejectLegacyChatOperation$('createChat');
  }

  /** @deprecated Alterações estruturais pertencem exclusivamente ao backend. */
  updateChat(_chatId: string, _updateData: Partial<IChat>): Observable<string> {
    return this.rejectLegacyChatOperation$('updateChat');
  }

  /** @deprecated Exclusão estrutural não existe no contrato cliente. */
  deleteChat(_chatId: string): Observable<void> {
    return this.rejectLegacyChatOperation$('deleteChat');
  }

  /** @deprecated Use DirectThreadService.deleteMessage$ (soft delete callable). */
  deleteMessage(_chatId: string, _messageId: string): Observable<void> {
    return this.rejectLegacyChatOperation$('deleteMessage');
  }

  setMessageReaction(chatId: string, messageId: string, emoji: string | null): Observable<void> {
    const cid = (chatId ?? '').toString().trim();
    const mid = (messageId ?? '').toString().trim();
    const safeEmoji = String(emoji ?? '').trim() || null;

    if (!cid || !mid) {
      return this.reportSilent('setMessageReaction', new Error('ids inválidos'));
    }

    return this.requireUidOnce$().pipe(
      switchMap((uid) =>
        this.sessionBoundWrite$(
          uid,
          this.msgsRepo.setMessageReaction$(cid, mid, uid, safeEmoji)
        )
      ),
      catchError(err => this.reportSilent('setMessageReaction', err))
    );
  }

  // ===========================================================================
  // Participant details (usa o DONO do getUser$)
  // ===========================================================================
  /**
   * Compatibilidade sem acesso a /users privado de terceiros.
   * O enrichment moderno usa exclusivamente projeções públicas na facade.
   */
  fetchAndPersistParticipantDetails(
    _chatId: string,
    _participantUid: string
  ): Observable<IChat | null> {
    return of(null);
  }

  refreshParticipantDetailsIfNeeded(_chatId: string): void {
    // No-op: DirectChatFacade.enrichListItemsWithPublicProfiles$ é a autoridade.
  }

  // ===========================================================================
  // Mensagens (sem dispatch NgRx)
  // ===========================================================================
  /** @deprecated Use DirectThreadService.sendMessage$ (sendDirectMessage callable). */
  sendMessage(_chatId: string, _message: Message, _senderId: string): Observable<string> {
    return this.rejectLegacyChatOperation$('sendMessage');
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

    return this.requireUidOnce$().pipe(
      switchMap((uid) =>
        this.sessionBoundWrite$(
          uid,
          this.msgsRepo.updateMessageStatus$(cid, mid, status)
        )
      ),
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

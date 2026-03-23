// src/app/messaging/direct-chat/services/direct-thread.service.ts
// ============================================================================
// DIRECT THREAD SERVICE
//
// Responsabilidade deste service:
// - observar mensagens de um chat direto 1:1
// - enviar mensagem para um chat direto 1:1
// - excluir mensagem de um chat direto 1:1
//
// Observação arquitetural:
// - nesta fase, o transporte/infra ainda usa ChatService como adapter legado
// - a sessão é a fonte primária de identidade
// - o perfil runtime é usado como enriquecimento (nickname), não como verdade de sessão
//
// Restrições e participação:
// - leitura e envio continuam condicionados aos gates de acesso
// - ownership/participação real deve continuar reforçada nas rules/backend
// - este service já prepara a camada 1:1 para futura troca do adapter legado
// ============================================================================

import { Injectable } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { Timestamp } from '@firebase/firestore';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { ChatService } from '@core/services/batepapo/chat-service/chat.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { environment } from 'src/environments/environment';

type DirectSenderContext = {
  uid: string | null;
  nickname: string;
  canSend: boolean;
};

@Injectable({ providedIn: 'root' })
export class DirectThreadService {
  private readonly debug = !environment.production;

  constructor(
    private readonly chatService: ChatService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly authSession: AuthSessionService,
    private readonly accessControl: AccessControlService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) {}

  // ---------------------------------------------------------------------------
  // Streams base
  // ---------------------------------------------------------------------------

  /**
   * Contexto mínimo para envio de mensagem direta.
   *
   * Regras:
   * - uid vem prioritariamente da sessão
   * - nickname tenta usar o perfil runtime; se não houver, usa displayName/auth fallback
   * - canSend depende do gate atual de acesso ao realtime/produto
   */
  private readonly senderContext$: Observable<DirectSenderContext> = combineLatest([
    this.authSession.uid$,
    this.authSession.authUser$,
    this.currentUserStore.user$,
    this.accessControl.canListenRealtime$,
  ]).pipe(
    map(([sessionUid, authUser, appUser, canListen]) => {
      const uid = (sessionUid ?? '').trim() || null;

      const runtimeNickname =
        appUser && appUser !== null && appUser !== undefined
          ? (appUser.nickname ?? '').trim()
          : '';

      const authNickname = (authUser?.displayName ?? '').trim();

      return {
        uid,
        nickname: runtimeNickname || authNickname || 'Usuário',
        canSend: !!uid && canListen === true,
      };
    }),
    distinctUntilChanged(
      (a, b) =>
        a.uid === b.uid &&
        a.nickname === b.nickname &&
        a.canSend === b.canSend
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ---------------------------------------------------------------------------
  // Observe
  // ---------------------------------------------------------------------------

  /**
   * Observa mensagens do chat direto.
   *
   * Observação:
   * - nesta fase ainda delega o stream para ChatService.monitorChat(...)
   * - o gate de acesso é reativo, não congelado
   */
  observeMessages$(chatId: string): Observable<Message[]> {
    const safeChatId = (chatId ?? '').trim();
    if (!safeChatId) {
      return of([]);
    }

    return this.accessControl.canListenRealtime$.pipe(
      switchMap((canListen) => {
        if (!canListen) {
          this.dbg('observeMessages$ blocked', { chatId: safeChatId });
          return of([] as Message[]);
        }

        return this.chatService.monitorChat(safeChatId);
      }),
      tap((messages) => {
        this.dbg('observeMessages$', {
          chatId: safeChatId,
          count: Array.isArray(messages) ? messages.length : 0,
        });
      }),
      catchError((error) => {
        this.reportSilent(error, 'DirectThreadService.observeMessages$', {
          chatId: safeChatId,
        });
        return of([] as Message[]);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  /**
   * Envia mensagem para um chat direto.
   *
   * Fonte de verdade da identidade:
   * - AuthSessionService
   *
   * O perfil runtime é usado apenas para nickname.
   */
  sendMessage$(chatId: string, content: string): Observable<string | null> {
    const safeChatId = (chatId ?? '').trim();
    const safeContent = (content ?? '').trim();

    if (!safeChatId || !safeContent) {
      return of(null);
    }

    return this.senderContext$.pipe(
      take(1),
      switchMap((ctx) => {
        if (!ctx.uid || !ctx.canSend) {
          this.errorNotifier.showWarning('Você não pode enviar mensagens agora.');
          return of(null);
        }

        const message = this.buildMessage(ctx.uid, ctx.nickname, safeContent);

        return this.chatService.sendMessage(safeChatId, message, ctx.uid).pipe(
          tap((messageId) => {
            this.dbg('sendMessage$', {
              chatId: safeChatId,
              messageId,
            });
          }),
          catchError((error) => {
            this.reportUi(
              error,
              'DirectThreadService.sendMessage$',
              'Não foi possível enviar a mensagem.',
              { chatId: safeChatId }
            );
            return of(null);
          })
        );
      }),
      catchError((error) => {
        this.reportUi(
          error,
          'DirectThreadService.sendMessage$',
          'Não foi possível obter os dados da sessão.',
          { chatId: safeChatId }
        );
        return of(null);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  /**
   * Exclui mensagem de um chat direto.
   *
   * Observação:
   * - ownership real continua sendo responsabilidade das rules/backend
   * - aqui fazemos apenas validação mínima local
   */
  deleteMessage$(chatId: string, messageId: string): Observable<void> {
    const safeChatId = (chatId ?? '').trim();
    const safeMessageId = (messageId ?? '').trim();

    if (!safeChatId || !safeMessageId) {
      return of(void 0);
    }

    return this.accessControl.canListenRealtime$.pipe(
      take(1),
      switchMap((canDelete) => {
        if (!canDelete) {
          return of(void 0);
        }

        return this.chatService.deleteMessage(safeChatId, safeMessageId).pipe(
          tap(() => {
            this.dbg('deleteMessage$', {
              chatId: safeChatId,
              messageId: safeMessageId,
            });
          }),
          catchError((error) => {
            this.reportUi(
              error,
              'DirectThreadService.deleteMessage$',
              'Não foi possível excluir a mensagem.',
              {
                chatId: safeChatId,
                messageId: safeMessageId,
              }
            );
            return of(void 0);
          })
        );
      }),
      catchError((error) => {
        this.reportSilent(error, 'DirectThreadService.deleteMessage$', {
          chatId: safeChatId,
          messageId: safeMessageId,
        });
        return of(void 0);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildMessage(uid: string, nickname: string, content: string): Message {
    return {
      content,
      senderId: uid,
      nickname: nickname?.trim() || 'Usuário',
      timestamp: Timestamp.now(),
    };
  }

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[DirectThreadService] ${message}`, extra ?? '');
  }

  private reportSilent(
    error: unknown,
    context: string,
    extra?: Record<string, unknown>
  ): void {
    try {
      const err =
        error instanceof Error
          ? error
          : new Error('[DirectThreadService] operation failed');

      (err as any).original = error;
      (err as any).context = context;
      (err as any).extra = extra;
      (err as any).skipUserNotification = true;
      (err as any).silent = true;

      this.globalErrorHandler.handleError(err);
    } catch {
      // noop
    }
  }

  private reportUi(
    error: unknown,
    context: string,
    message: string,
    extra?: Record<string, unknown>
  ): void {
    try {
      this.errorNotifier.showError(message);
    } catch {
      // noop
    }

    this.reportSilent(error, context, extra);
  }
}

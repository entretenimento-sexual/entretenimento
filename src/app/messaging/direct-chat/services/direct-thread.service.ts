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
import { Functions, httpsCallable } from '@angular/fire/functions';

import { Observable, defer, from, of } from 'rxjs';
import {
  catchError,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

import { ChatService } from '@core/services/batepapo/chat-service/chat.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { environment } from 'src/environments/environment';

interface SendDirectMessagePayload {
  chatId: string;
  content: string;
  clientRequestId: string;
}

interface SendDirectMessageResponse {
  chatId: string;
  messageId: string;
  deduplicated: boolean;
}

@Injectable({ providedIn: 'root' })
export class DirectThreadService {
  private readonly debug = !environment.production;

  private readonly sendDirectMessageCallable = httpsCallable<
    SendDirectMessagePayload,
    SendDirectMessageResponse
  >(this.functions, 'sendDirectMessage');

  constructor(
    private readonly functions: Functions,
    private readonly chatService: ChatService,
    private readonly accessControl: AccessControlService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) {}

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
sendMessage$(
  chatId: string,
  content: string,
  clientRequestId = this.createClientRequestId()
): Observable<string | null> {
  const safeChatId = (chatId ?? '').trim();
  const safeContent = (content ?? '').trim();
  const safeClientRequestId = (clientRequestId ?? '').trim();

  if (!safeChatId || !safeContent) {
    return of(null);
  }

  if (safeContent.length > 1000) {
    this.errorNotifier.showWarning(
      'A mensagem deve ter no máximo 1000 caracteres.'
    );
    return of(null);
  }

  if (!safeClientRequestId) {
    this.errorNotifier.showError(
      'Não foi possível preparar o envio da mensagem.'
    );
    return of(null);
  }

  return defer(() =>
    from(
      this.sendDirectMessageCallable({
        chatId: safeChatId,
        content: safeContent,
        clientRequestId: safeClientRequestId,
      })
    )
  ).pipe(
    map((result) => {
      const messageId = String(result.data?.messageId ?? '').trim();

      if (!messageId) {
        throw new Error('Resposta inválida ao enviar mensagem direta.');
      }

      this.dbg('sendMessage$ callable ok', {
        chatId: safeChatId,
        messageId,
        deduplicated: result.data?.deduplicated === true,
      });

      return messageId;
    }),

    catchError((error) => {
      this.reportUi(
        error,
        'DirectThreadService.sendMessage$',
        this.getSendMessageUserMessage(error),
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

private createClientRequestId(): string {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  return [
    'dm',
    Date.now().toString(36),
    Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2),
  ].join('_');
}

private getSendMessageUserMessage(error: unknown): string {
  const code = String(
    (error as { code?: unknown } | null)?.code ?? ''
  ).toLowerCase();

  const message = String(
    (error as { message?: unknown } | null)?.message ?? ''
  ).toLowerCase();

  if (code.includes('unauthenticated')) {
    return 'Entre novamente para enviar mensagens.';
  }

  if (code.includes('invalid-argument')) {
    if (message.includes('máximo') || message.includes('limite')) {
      return 'A mensagem deve ter no máximo 1000 caracteres.';
    }

    return 'Revise a mensagem antes de enviar.';
  }

  if (code.includes('failed-precondition')) {
    if (message.includes('verifique seu e-mail')) {
      return 'Verifique seu e-mail antes de enviar mensagens.';
    }

    if (message.includes('complete seu perfil')) {
      return 'Complete seu perfil antes de enviar mensagens.';
    }

    return 'Não foi possível enviar a mensagem nas condições atuais.';
  }

  if (code.includes('permission-denied')) {
    return 'Esta conversa não está disponível para mensagens.';
  }

  return 'Não foi possível enviar a mensagem.';
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

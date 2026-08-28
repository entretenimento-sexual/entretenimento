// src/app/messaging/direct-chat/services/direct-receipts.service.ts
// ============================================================================
// DIRECT RECEIPTS SERVICE
//
// Responsabilidade:
// - avançar recibos de leitura de mensagens diretas 1:1;
// - respeitar as Firestore Rules:
//   sent      -> delivered
//   delivered -> read
//
// Importante:
// - o cliente NÃO pode fazer sent -> read diretamente;
// - por isso o avanço precisa ser progressivo;
// - falha de receipts é best-effort e não deve quebrar a thread.
// ============================================================================

import { Injectable } from '@angular/core';

import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

import { ChatService } from '@core/services/batepapo/chat-service/chat.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';

type ReceiptTransitionTarget = 'delivered' | 'read';

type ReceiptTransition = {
  messageId: string;
  nextStatus: ReceiptTransitionTarget;
};

@Injectable({ providedIn: 'root' })
export class DirectReceiptsService {
  private readonly maxUpdatesPerTick = 50;

  constructor(
    private readonly chatService: ChatService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  /**
   * Avança recibos das mensagens recebidas.
   *
   * Regras:
   * - mensagem minha: nunca altera;
   * - mensagem sem id: ignora;
   * - read: ignora;
   * - sent: avança para delivered;
   * - delivered: avança para read.
   *
   * Observação:
   * - uma mensagem sent não vira read diretamente por causa das Rules;
   * - depois que o snapshot atualizar para delivered, esta função pode avançar
   *   novamente para read.
   */
  markDeliveredAsRead$(
    chatId: string,
    currentUserUid: string,
    messages: Message[]
  ): Observable<number> {
    const safeChatId = (chatId ?? '').trim();
    const safeUid = (currentUserUid ?? '').trim();
    const safeMessages = Array.isArray(messages) ? messages : [];

    if (!safeChatId || !safeUid || !safeMessages.length) {
      return of(0);
    }

    const transitions = this.pickReceiptTransitions(safeUid, safeMessages);

    if (!transitions.length) {
      return of(0);
    }

    return forkJoin(
      transitions.map((transition) =>
        this.chatService
          .updateMessageStatus(
            safeChatId,
            transition.messageId,
            transition.nextStatus
          )
          .pipe(
            catchError((error) => {
              this.reportSilent(
                error,
                'DirectReceiptsService.markDeliveredAsRead$.updateMessageStatus',
                {
                  chatId: safeChatId,
                  messageId: transition.messageId,
                  nextStatus: transition.nextStatus,
                }
              );

              return of(void 0);
            })
          )
      )
    ).pipe(
      tap(() => {
        this.dbg('markDeliveredAsRead$', {
          chatId: safeChatId,
          count: transitions.length,
          deliveredCount: transitions.filter(
            (transition) => transition.nextStatus === 'delivered'
          ).length,
          readCount: transitions.filter(
            (transition) => transition.nextStatus === 'read'
          ).length,
        });
      }),
      map(() => transitions.length),
      catchError((error) => {
        this.reportSilent(
          error,
          'DirectReceiptsService.markDeliveredAsRead$',
          { chatId: safeChatId }
        );

        return of(0);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private pickReceiptTransitions(
    currentUserUid: string,
    messages: Message[]
  ): ReceiptTransition[] {
    return messages
      .map((message): ReceiptTransition | null => {
        const messageId = String(message?.id ?? '').trim();

        if (!messageId) {
          return null;
        }

        if (message?.senderId === currentUserUid) {
          return null;
        }

        const status = message?.status ?? 'sent';

        if (status === 'sent') {
          return {
            messageId,
            nextStatus: 'delivered',
          };
        }

        if (status === 'delivered') {
          return {
            messageId,
            nextStatus: 'read',
          };
        }

        return null;
      })
      .filter((transition): transition is ReceiptTransition => !!transition)
      .slice(0, this.maxUpdatesPerTick);
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('chat', `DirectReceiptsService: ${message}`, extra);
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
          : new Error('[DirectReceiptsService] operation failed');

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
}
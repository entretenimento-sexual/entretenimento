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
// - o avanço usa transação e o estado atual persistido;
// - mensagens legadas sem status explícito são ignoradas;
// - falha de receipts é best-effort e não deve quebrar a thread.
// ============================================================================

import { Injectable } from '@angular/core';

import { Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

import { ChatMessagesRepository } from '@core/services/data-handling/firestore/repositories/chat-messages.repository';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';

@Injectable({ providedIn: 'root' })
export class DirectReceiptsService {
  private readonly maxUpdatesPerTick = 50;

  constructor(
    private readonly messagesRepository: ChatMessagesRepository,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  /**
   * Avança receipts das mensagens recebidas.
   *
   * Regras defensivas:
   * - mensagem minha: nunca altera;
   * - mensagem sem id: ignora;
   * - mensagem sem status explícito: ignora;
   * - read: ignora;
   * - sent/delivered: encaminha para transação no repository.
   *
   * A decisão final usa o snapshot lido dentro da transação. Assim, emissões
   * concorrentes do listener não repetem uma escrita com estado já vencido.
   */
  markDeliveredAsRead$(
    chatId: string,
    currentUserUid: string,
    messages: Message[]
  ): Observable<number> {
    const safeChatId = String(chatId ?? '').trim();
    const safeUid = String(currentUserUid ?? '').trim();
    const safeMessages = Array.isArray(messages) ? messages : [];

    if (!safeChatId || !safeUid || !safeMessages.length) {
      return of(0);
    }

    const messageIds = this.pickReceiptMessageIds(safeUid, safeMessages);

    if (!messageIds.length) {
      return of(0);
    }

    return this.messagesRepository
      .advanceMessageReceipts$(safeChatId, safeUid, messageIds)
      .pipe(
        tap((updatedCount) => {
          this.dbg('markDeliveredAsRead$', {
            chatId: safeChatId,
            candidateCount: messageIds.length,
            updatedCount,
          });
        }),
        catchError((error) => {
          this.reportSilent(
            error,
            'DirectReceiptsService.markDeliveredAsRead$',
            {
              chatId: safeChatId,
              candidateCount: messageIds.length,
            }
          );

          return of(0);
        })
      );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private pickReceiptMessageIds(
    currentUserUid: string,
    messages: Message[]
  ): string[] {
    const messageIds = messages
      .map((message): string | null => {
        const messageId = String(message?.id ?? '').trim();
        const senderUid = String(
          message?.senderUid ?? message?.senderId ?? ''
        ).trim();
        const status = message?.status;

        if (!messageId || !senderUid || senderUid === currentUserUid) {
          return null;
        }

        if (status !== 'sent' && status !== 'delivered') {
          return null;
        }

        return messageId;
      })
      .filter((messageId): messageId is string => !!messageId);

    return Array.from(new Set(messageIds)).slice(0, this.maxUpdatesPerTick);
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

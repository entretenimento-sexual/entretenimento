// src/app/messaging/direct-chat/services/direct-receipts.service.ts
// ============================================================================
// DIRECT RECEIPTS SERVICE
//
// Responsabilidade deste service:
// - marcar como lidas mensagens diretas 1:1 que estavam em delivered
//
// Observação arquitetural:
// - nesta fase ainda usa ChatService como adapter legado
// - o serviço é best-effort por definição
// - falha de receipts não deve quebrar renderização da thread
//
// Restrições:
// - só marca mensagens recebidas
// - só marca mensagens com id válido
// - limita updates por tick para evitar rajadas desnecessárias
// ============================================================================

import { Injectable } from '@angular/core';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { ChatService } from '@core/services/batepapo/chat-service/chat.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class DirectReceiptsService {
  private readonly maxUpdatesPerTick = 50;
  private readonly debug = !environment.production;

  constructor(
    private readonly chatService: ChatService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  /**
   * Marca como read apenas mensagens:
   * - recebidas
   * - em status delivered
   * - com id válido
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

    const toMark = this.pickMessagesToMark(safeUid, safeMessages);

    if (!toMark.length) {
      return of(0);
    }

    return forkJoin(
      toMark.map((message) =>
        this.chatService
          .updateMessageStatus(safeChatId, String(message.id), 'read')
          .pipe(
            catchError((error) => {
              this.reportSilent(
                error,
                'DirectReceiptsService.markDeliveredAsRead$.updateMessageStatus',
                {
                  chatId: safeChatId,
                  messageId: String(message.id),
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
          count: toMark.length,
        });
      }),
      map(() => toMark.length),
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

  private pickMessagesToMark(
    currentUserUid: string,
    messages: Message[]
  ): Message[] {
    return messages
      .filter((message) => {
        return (
          message?.status === 'delivered' &&
          message?.senderId !== currentUserUid &&
          !!message?.id
        );
      })
      .slice(0, this.maxUpdatesPerTick);
  }

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[DirectReceiptsService] ${message}`, extra ?? '');
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

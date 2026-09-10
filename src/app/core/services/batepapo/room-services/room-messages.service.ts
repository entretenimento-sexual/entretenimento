// src/app/core/services/batepapo/room-services/room-messages.service.ts
// Compatibilidade de mensagens de Sala. O cliente não lê nem grava este legado.

import { Injectable } from '@angular/core';
import { Observable, defer, firstValueFrom, of } from 'rxjs';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { Message } from '@core/interfaces/interfaces-chat/message.interface';

@Injectable({ providedIn: 'root' })
export class RoomMessagesService {
  constructor(
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) {}

  /**
   * SUPRESSÃO EXPLÍCITA: o listener em `rooms/{roomId}/messages` foi removido.
   * As Rules fecham leitura/escrita e não existe produtor moderno de mensagens de Sala.
   */
  getRoomMessages(roomId: string, _pageSize = 200): Observable<Message[]> {
    void roomId;
    void _pageSize;
    return of([]);
  }

  /**
   * SUPRESSÃO EXPLÍCITA: a antiga escrita `addDoc` foi removida. Mantemos o retorno
   * vazio já usado pelo fallback legado, mas agora sem request negada/custo de rede.
   */
  sendMessageToRoom$(roomId: string, _message: Message): Observable<string> {
    const rid = this.normRoomId(roomId);
    void _message;
    if (!rid) return of('');

    return defer(() => {
      this.reportDeprecatedUse('sendMessageToRoom$', { roomId: rid });
      this.errorNotifier.showInfo(
        'Mensagens em Salas foram descontinuadas. Use Comunidades ou o chat direto.'
      );
      return of('');
    });
  }

  /** Compatibilidade Promise para consumidores antigos. */
  async sendMessageToRoom(roomId: string, message: any): Promise<void> {
    await firstValueFrom(
      this.sendMessageToRoom$(roomId, message as Message)
    );
  }

  /**
   * SUPRESSÃO EXPLÍCITA: read receipts de Sala não geram mais escrita Firestore.
   */
  updateMessageStatus(
    roomId: string,
    messageId: string,
    _status: 'sent' | 'delivered' | 'read',
    _notifyUser = false
  ): Observable<void> {
    void roomId;
    void messageId;
    void _status;
    void _notifyUser;
    return of(void 0);
  }

  /** O domínio congelado não produz novos receipts; mantém API reativa compatível. */
  markDeliveredAsRead$(
    roomId: string,
    myUid: string,
    messages: Message[]
  ): Observable<number> {
    void roomId;
    void myUid;
    void messages;
    return of(0);
  }

  private normRoomId(roomId: string): string {
    return (roomId ?? '').toString().trim();
  }

  private reportDeprecatedUse(
    action: string,
    extra?: Record<string, unknown>
  ): void {
    try {
      const error = new Error(
        `[RoomMessagesService.${action}] operação bloqueada: Salas depreciadas.`
      );
      (error as any).code = 'failed-precondition';
      (error as any).silent = true;
      (error as any).skipUserNotification = true;
      (error as any).context = {
        scope: 'RoomMessagesService',
        action,
        productState: 'deprecated_compatibility_only',
        ...(extra ?? {}),
      };
      this.globalErrorHandler.handleError(error);
    } catch {
      // Feedback de produto e retorno compatível não dependem da telemetria.
    }
  }
}

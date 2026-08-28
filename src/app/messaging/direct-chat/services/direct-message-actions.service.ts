// src/app/messaging/direct-chat/services/direct-message-actions.service.ts
// -----------------------------------------------------------------------------
// DirectMessageActionsService
// -----------------------------------------------------------------------------
// Ações operacionais em mensagens diretas que exigem backend confiável.
//
// Nesta etapa:
// - remover mensagem própria via callable deleteDirectMessage;
// - o cliente não faz deleteDoc físico;
// - erro volta para a UI em vez de ser engolido silenciosamente.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from } from 'rxjs';
import { map } from 'rxjs/operators';

interface DeleteDirectMessagePayload {
  chatId: string;
  messageId: string;
}

interface DeleteDirectMessageResponse {
  chatId: string;
  messageId: string;
  deleted: true;
}

@Injectable({ providedIn: 'root' })
export class DirectMessageActionsService {
  private readonly deleteDirectMessageCallable = httpsCallable<
    DeleteDirectMessagePayload,
    DeleteDirectMessageResponse
  >(this.functions, 'deleteDirectMessage');

  constructor(private readonly functions: Functions) {}

  deleteDirectMessage$(chatId: string, messageId: string): Observable<void> {
    const safeChatId = String(chatId ?? '').trim();
    const safeMessageId = String(messageId ?? '').trim();

    return defer(() =>
      from(
        this.deleteDirectMessageCallable({
          chatId: safeChatId,
          messageId: safeMessageId,
        })
      )
    ).pipe(map(() => void 0));
  }
}

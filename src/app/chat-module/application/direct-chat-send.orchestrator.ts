import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from 'src/app/messaging/direct-chat/application/direct-thread.facade';
import { resolveDirectMessageBlockMessage } from '../policies/direct-chat-composer.policy';

export interface DirectChatSendResult {
  messageId: string | null;
  blockedReason: string | null;
}

@Injectable()
export class DirectChatSendOrchestrator {
  constructor(
    private readonly directChatFacade: DirectChatFacade,
    private readonly directThreadFacade: DirectThreadFacade
  ) {}

  send$(
    chatId: string,
    content: string
  ): Observable<DirectChatSendResult> {
    const safeChatId = String(chatId ?? '').trim();
    const safeContent = String(content ?? '').trim();

    if (!safeChatId || !safeContent) {
      return of({
        messageId: null,
        blockedReason: null,
      });
    }

    this.directChatFacade.selectChat(safeChatId);

    return this.directThreadFacade.sendMessage$(safeContent).pipe(
      map((messageId) => ({
        messageId: messageId ?? null,
        blockedReason: null,
      })),
      catchError((error) =>
        of({
          messageId: null,
          blockedReason: resolveDirectMessageBlockMessage(error),
        })
      )
    );
  }
}

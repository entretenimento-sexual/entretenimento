import { Injectable } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
} from 'rxjs/operators';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { DirectChatFacade } from 'src/app/messaging/direct-chat/application/direct-chat.facade';
import { DirectThreadFacade } from 'src/app/messaging/direct-chat/application/direct-thread.facade';

export interface DirectChatComposeAccessState {
  canCompose: boolean;
  canSendDirect: boolean;
  /** Legacy flag: confirmed bilateral availability; false does not prove friendship is absent. */
  hasAcceptedConnection: boolean;
  canSendCurrentMessage: boolean;
  statusMessage: string;
}

@Injectable()
export class DirectChatComposeAccessFacade {
  constructor(
    private readonly accessControl: AccessControlService,
    private readonly directChatFacade: DirectChatFacade,
    private readonly directThreadFacade: DirectThreadFacade,
    private readonly applicationError: ApplicationErrorService
  ) {}

  observe$(
    currentUid$: Observable<string | null>,
    peerUid$: Observable<string | null>,
    selectedType$: Observable<'chat' | null>,
    selectedChatId$: Observable<string | null>
  ): Observable<DirectChatComposeAccessState> {
    return combineLatest([
      currentUid$,
      peerUid$,
      selectedType$,
      selectedChatId$,
      this.accessControl.canListenRealtime$,
      this.directChatFacade.selectedChatAccess$,
      this.directThreadFacade.canSend$,
    ]).pipe(
      map(([owner, peer, selectedType, selectedChatId, canListen, access, threadCanSend]) => {
        const canCompose = !!owner && canListen === true;
        // The server projection already checks both accepted friend edges and
        // bilateral blocks. Verify its context rather than a replayed boolean.
        const hasAcceptedConnection = !!owner && !!peer && !!selectedChatId &&
          selectedType === 'chat' && access?.owner === owner && access.peer === peer &&
          access.chatId === selectedChatId && access.readable === true &&
          access.available === true;
        const canSendDirect = hasAcceptedConnection && threadCanSend === true;
        return {
          canCompose,
          canSendDirect,
          hasAcceptedConnection,
          canSendCurrentMessage: canCompose && canSendDirect,
          statusMessage: this.resolveStatusMessage({ selectedChatId, selectedType, canCompose, canSendDirect, hasAcceptedConnection }),
        };
      }),
      catchError(error => {
        this.applicationError.report(error, {
          feature: 'direct-chat',
          operation: 'DirectChatComposeAccessFacade.observe$',
          fallbackMessage: 'Não foi possível verificar a disponibilidade desta conversa.',
          presentation: { surface: 'none', severity: 'error' },
          metadata: { scope: 'DirectChatComposeAccessFacade' },
        });
        return of({
          canCompose: false, canSendDirect: false, hasAcceptedConnection: false,
          canSendCurrentMessage: false,
          statusMessage: 'Não foi possível verificar a disponibilidade desta conversa.',
        });
      }),
      distinctUntilChanged(
        (a, b) =>
          a.canCompose === b.canCompose &&
          a.canSendDirect === b.canSendDirect &&
          a.hasAcceptedConnection === b.hasAcceptedConnection &&
          a.canSendCurrentMessage === b.canSendCurrentMessage &&
          a.statusMessage === b.statusMessage
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private resolveStatusMessage(input: {
    selectedChatId: string | null;
    selectedType: 'chat' | null;
    canCompose: boolean;
    canSendDirect: boolean;
    hasAcceptedConnection: boolean;
  }): string {
    if (!input.selectedChatId || !input.selectedType) {
      return 'Selecione uma conversa para enviar mensagem.';
    }

    if (!input.canCompose) {
      return 'Seu perfil ainda não pode enviar mensagens neste momento.';
    }

    if (!input.canSendDirect) {
      return 'Esta conversa direta não está disponível para envio agora.';
    }

    return 'Conversa direta liberada para envio.';
  }
}

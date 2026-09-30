import { Injectable } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { DirectThreadFacade } from 'src/app/messaging/direct-chat/application/direct-thread.facade';

export interface DirectChatComposeAccessState {
  canCompose: boolean;
  canSendDirect: boolean;
  hasAcceptedConnection: boolean;
  canSendCurrentMessage: boolean;
  statusMessage: string;
}

@Injectable()
export class DirectChatComposeAccessFacade {
  constructor(
    private readonly accessControl: AccessControlService,
    private readonly friendshipService: FriendshipService,
    private readonly directThreadFacade: DirectThreadFacade,
    private readonly applicationError: ApplicationErrorService
  ) {}

  observe$(
    currentUid$: Observable<string | null>,
    peerUid$: Observable<string | null>,
    selectedType$: Observable<'chat' | null>,
    selectedChatId$: Observable<string | null>
  ): Observable<DirectChatComposeAccessState> {
    const canCompose$ = combineLatest([
      currentUid$,
      this.accessControl.canListenRealtime$,
    ]).pipe(
      map(([uid, canListen]) => !!uid && canListen === true),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const hasAcceptedConnection$ = combineLatest([
      currentUid$,
      peerUid$,
    ]).pipe(
      switchMap(([currentUid, peerUid]) => {
        const safeCurrentUid = (currentUid ?? '').trim();
        const safePeerUid = (peerUid ?? '').trim();

        if (!safeCurrentUid || !safePeerUid) {
          return of(false);
        }

        return this.friendshipService.watchFriends(safeCurrentUid).pipe(
          map((friends: Friend[]) =>
            (friends ?? []).some(
              (friend) =>
                String(friend?.friendUid ?? '').trim() === safePeerUid
            )
          ),
          catchError((error) => {
            this.applicationError.report(error, {
              feature: 'direct-chat',
              operation: 'DirectChatComposeAccessFacade.watchFriends',
              fallbackMessage:
                'Não foi possível verificar a conexão com este perfil.',
              presentation: { surface: 'none', severity: 'error' },
              metadata: {
                scope: 'DirectChatComposeAccessFacade',
                currentUid: safeCurrentUid,
                peerUid: safePeerUid,
              },
            });

            return of(false);
          })
        );
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    return combineLatest([
      canCompose$,
      this.directThreadFacade.canSend$,
      selectedType$,
      hasAcceptedConnection$,
      selectedChatId$,
    ]).pipe(
      map(([
        canCompose,
        canSendDirect,
        selectedType,
        hasAcceptedConnection,
        selectedChatId,
      ]) => {
        const canSendCurrentMessage =
          selectedType === 'chat' &&
          !!selectedChatId &&
          canCompose &&
          canSendDirect &&
          hasAcceptedConnection;

        return {
          canCompose,
          canSendDirect,
          hasAcceptedConnection,
          canSendCurrentMessage,
          statusMessage: this.resolveStatusMessage({
            selectedChatId,
            selectedType,
            canCompose,
            canSendDirect,
            hasAcceptedConnection,
          }),
        };
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

    if (!input.hasAcceptedConnection) {
      return 'Vocês precisam estar conectados para trocar mensagens.';
    }

    if (!input.canSendDirect) {
      return 'Esta conversa direta não está disponível para envio agora.';
    }

    return 'Conversa direta liberada para envio.';
  }
}

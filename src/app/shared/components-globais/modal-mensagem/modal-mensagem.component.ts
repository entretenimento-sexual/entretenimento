// src/app/shared/components-globais/modal-mensagem/modal-mensagem.component.ts
// Modal para envio de mensagem direta a partir de um perfil.
// Ajustes desta versão:
// - usa AuthSessionService + CurrentUserStoreService
// - mantém Observable-first
// - centraliza feedback de erro
// - corrige tipagem do usuário atual e do callback de erro

import { Component, Output, EventEmitter, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from '@firebase/firestore';

import { combineLatest, EMPTY, throwError } from 'rxjs';
import { switchMap, take, map, catchError } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';

import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-modal-mensagem',
  templateUrl: './modal-mensagem.component.html',
  styleUrls: ['./modal-mensagem.component.css'],
  standalone: false
})
export class ModalMensagemComponent {
  @Output() mensagemEnviada = new EventEmitter<string>();

  mensagem = '';

  constructor(
    public dialogRef: MatDialogRef<ModalMensagemComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { profile: IUserDados },
private readonly chatService: ChatService,
private readonly directChatService: DirectChatService,
private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) {
    console.log('Data recebida:', data);
  }

  enviarMensagem(): void {
    const conteudo = this.mensagem.trim();
    const profileUid = (this.data?.profile?.uid ?? '').trim();

    if (!conteudo) {
      this.errorNotifier.showWarning?.('Digite uma mensagem antes de enviar.');
      return;
    }

    if (!profileUid) {
      this.handleError(new Error('Perfil de destino não identificado.'), {
        op: 'enviarMensagem.profileUid'
      });
      return;
    }

    combineLatest([
      this.authSession.uid$,
      this.currentUserStore.user$
    ])
      .pipe(
        take(1),
        map(([authUid, appUser]) => {
          const currentUserUid = (authUid ?? '').trim();

          if (!currentUserUid) {
            throw new Error('Usuário não autenticado.');
          }

          const nickname =
            (appUser && appUser !== null && appUser !== undefined
              ? (appUser.nickname ?? '').trim()
              : '') || 'Usuário';

          const mensagem: Message = {
            nickname,
            content: conteudo,
            senderId: currentUserUid,
            timestamp: Timestamp.now()
          };

          return {
            currentUserUid,
            profileUid,
            mensagem
          };
        }),
switchMap(({ currentUserUid, profileUid, mensagem }) =>
  this.directChatService.ensureDirectChatIdWithUser$(profileUid).pipe(
    switchMap((chatId) => {
      /**
       * O DirectChatService já exibiu feedback adequado quando a callable
       * bloqueia a abertura da conversa. Retornamos EMPTY para não duplicar
       * toasts e para não fechar o modal como se a mensagem tivesse sido enviada.
       */
      if (!chatId) {
        return EMPTY;
      }

      return this.chatService.sendMessage(chatId, mensagem, currentUserUid).pipe(
        switchMap((messageId) => {
          /**
           * O repository legado de mensagens ainda converte erro de escrita em
           * string vazia. Enquanto sendDirectMessage não migrar para callable,
           * tratamos esse retorno como falha real para impedir sucesso falso.
           */
          if (!String(messageId ?? '').trim()) {
            return throwError(() =>
              new Error('Não foi possível confirmar o envio da mensagem.')
            );
          }

          const chatUpdate: Partial<IChat> = {
            lastMessage: mensagem
          };

          return this.chatService.updateChat(chatId, chatUpdate);
        })
      );
    })
  )
),
        catchError((error: unknown) => {
          this.handleError(error, { op: 'enviarMensagem.pipeline', profileUid });
          return throwError(() => error);
        })
      )
      .subscribe({
        next: () => {
          console.log('Mensagem enviada com sucesso!');
          this.mensagemEnviada.emit(profileUid);
          this.dialogRef.close();
        },
        error: (error: unknown) => {
          console.log('Erro ao enviar mensagem:', error);
        }
      });
  }

  fecharModal(): void {
    this.dialogRef.close();
  }

  private handleError(error: unknown, context?: Record<string, unknown>): void {
    try {
      this.errorNotifier.showError('Erro ao enviar mensagem.');
    } catch {
      // noop
    }

    try {
      const err = error instanceof Error ? error : new Error('Erro ao enviar mensagem.');
      (err as any).original = error;
      (err as any).context = {
        scope: 'ModalMensagemComponent',
        ...(context ?? {})
      };
      (err as any).skipUserNotification = true;
      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}

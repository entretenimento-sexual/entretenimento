// src/app/shared/components-globais/modal-mensagem/modal-mensagem.component.ts
// -----------------------------------------------------------------------------
// MODAL MENSAGEM DIRETA
// -----------------------------------------------------------------------------
// Modal para iniciar uma conversa direta a partir de um perfil.
//
// Responsabilidades atuais:
// - obter remetente autenticado;
// - resolver/adotar conversa direta via callable segura;
// - enviar mensagem pelo fluxo legado temporário;
// - impedir submissão duplicada por clique repetido;
// - centralizar feedback de erro.
//
// Migração pendente:
// - o envio da mensagem ainda será movido para sendDirectMessage no backend.
// -----------------------------------------------------------------------------

import {
  Component,
  EventEmitter,
  Inject,
  Output,
  signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from '@firebase/firestore';

import { combineLatest, EMPTY, throwError } from 'rxjs';
import {
  catchError,
  finalize,
  map,
  switchMap,
  take,
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';

@Component({
  selector: 'app-modal-mensagem',
  templateUrl: './modal-mensagem.component.html',
  styleUrls: ['./modal-mensagem.component.css'],
  standalone: false,
})
export class ModalMensagemComponent {
  @Output() readonly mensagemEnviada = new EventEmitter<string>();

  readonly isSending = signal(false);

  mensagem = '';

  constructor(
    public readonly dialogRef: MatDialogRef<ModalMensagemComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: { profile: IUserDados },
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
    if (this.isSending()) {
      return;
    }

    const conteudo = this.mensagem.trim();
    const profileUid = (this.data?.profile?.uid ?? '').trim();

    if (!conteudo) {
      this.errorNotifier.showWarning?.('Digite uma mensagem antes de enviar.');
      return;
    }

    if (!profileUid) {
      this.handleError(new Error('Perfil de destino não identificado.'), {
        op: 'enviarMensagem.profileUid',
      });
      return;
    }

    this.isSending.set(true);
    this.dialogRef.disableClose = true;

    combineLatest([
      this.authSession.uid$,
      this.currentUserStore.user$,
    ])
      .pipe(
        take(1),

        map(([authUid, appUser]) => {
          const currentUserUid = (authUid ?? '').trim();

          if (!currentUserUid) {
            throw new Error('Usuário não autenticado.');
          }

          const nickname =
            (appUser?.nickname ?? '').trim() || 'Usuário';

          const mensagem: Message = {
            nickname,
            content: conteudo,
            senderId: currentUserUid,
            timestamp: Timestamp.now(),
          };

          return {
            currentUserUid,
            profileUid,
            mensagem,
          };
        }),

        switchMap(({ currentUserUid, profileUid: targetUid, mensagem }) =>
          this.directChatService.ensureDirectChatIdWithUser$(targetUid).pipe(
            switchMap((chatId) => {
              /**
               * O DirectChatService já informa ao usuário quando a callable
               * recusa a abertura da conversa. EMPTY evita toast duplicado e
               * impede fechamento do modal como se tivesse ocorrido envio.
               */
              if (!chatId) {
                return EMPTY;
              }

              return this.chatService
                .sendMessage(chatId, mensagem, currentUserUid)
                .pipe(
                  switchMap((messageId) => {
                    /**
                     * Proteção temporária:
                     * o repository legado pode converter falha de escrita em
                     * string vazia. Até sendDirectMessage existir no backend,
                     * retorno vazio será tratado como falha real.
                     */
                    if (!String(messageId ?? '').trim()) {
                      return throwError(() =>
                        new Error(
                          'Não foi possível confirmar o envio da mensagem.'
                        )
                      );
                    }

                    const chatUpdate: Partial<IChat> = {
                      lastMessage: mensagem,
                    };

                    return this.chatService.updateChat(chatId, chatUpdate);
                  })
                );
            })
          )
        ),

        catchError((error: unknown) => {
          this.handleError(error, {
            op: 'enviarMensagem.pipeline',
            profileUid,
          });

          return throwError(() => error);
        }),

        finalize(() => {
          this.isSending.set(false);
          this.dialogRef.disableClose = false;
        })
      )
      .subscribe({
        next: () => {
          this.errorNotifier.showSuccess?.('Mensagem enviada.');
          this.mensagemEnviada.emit(profileUid);
          this.dialogRef.close(true);
        },

        error: (error: unknown) => {
          console.log('Erro ao enviar mensagem:', error);
        },
      });
  }

  fecharModal(): void {
    if (this.isSending()) {
      return;
    }

    this.dialogRef.close();
  }

  private handleError(
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      this.errorNotifier.showError('Erro ao enviar mensagem.');
    } catch {
      // noop
    }

    try {
      const err =
        error instanceof Error
          ? error
          : new Error('Erro ao enviar mensagem.');

      (err as Error & { original?: unknown }).original = error;
      (
        err as Error & {
          context?: Record<string, unknown>;
        }
      ).context = {
        scope: 'ModalMensagemComponent',
        ...(context ?? {}),
      };
      (
        err as Error & {
          skipUserNotification?: boolean;
        }
      ).skipUserNotification = true;

      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}
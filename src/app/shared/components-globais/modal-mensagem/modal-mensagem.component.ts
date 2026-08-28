// src/app/shared/components-globais/modal-mensagem/modal-mensagem.component.ts
// -----------------------------------------------------------------------------
// MODAL MENSAGEM DIRETA
// -----------------------------------------------------------------------------
// Modal para iniciar uma conversa direta a partir de um perfil.
//
// Responsabilidades atuais:
// - resolver/adotar conversa direta via callable segura;
// - enviar mensagem por callable segura;
// - impedir submissão duplicada por clique repetido;
// - centralizar feedback inesperado de interface.
//
// Segurança:
// - o modal envia somente target uid e conteúdo;
// - identidade, nickname, lifecycle, bloqueios e persistência são validados
//   pelo backend.
// -----------------------------------------------------------------------------
import {
  Component,
  EventEmitter,
  Inject,
  Output,
  signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { EMPTY, throwError } from 'rxjs';
import {
  catchError,
  filter,
  finalize,
  map,
  switchMap,
  take,
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';
import { DirectThreadService } from 'src/app/messaging/direct-chat/services/direct-thread.service';

export interface ModalMensagemResult {
  ok: true;
  chatId: string;
  targetUid: string;
  messageId: string;
}

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
    private readonly directChatService: DirectChatService,
    private readonly directThreadService: DirectThreadService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) {}

  enviarMensagem(): void {
    if (this.isSending()) {
      return;
    }

    const content = this.mensagem.trim();
    const profileUid = (this.data?.profile?.uid ?? '').trim();

    if (!content) {
      this.errorNotifier.showWarning('Digite uma mensagem antes de enviar.');
      return;
    }

    if (!profileUid) {
      this.handleUnexpectedError(
        new Error('Perfil de destino não identificado.'),
        { op: 'enviarMensagem.profileUid' }
      );
      return;
    }

    this.isSending.set(true);
    this.dialogRef.disableClose = true;

    this.directChatService
      .ensureDirectChatIdWithUser$(profileUid)
      .pipe(
        take(1),

      switchMap((chatId) => {
        if (!chatId) {
          return EMPTY;
        }

        return this.directThreadService.sendMessage$(chatId, content).pipe(
          map((messageId) => ({
            chatId,
            targetUid: profileUid,
            messageId,
          }))
        );
      }),

      filter((result): result is {
        chatId: string;
        targetUid: string;
        messageId: string;
      } => {
        return !!result.chatId && !!result.targetUid && !!result.messageId;
      }),

        catchError((error: unknown) => {
          this.handleUnexpectedError(error, {
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
        next: (result) => {
          this.errorNotifier.showSuccess('Mensagem enviada.');
          this.mensagemEnviada.emit(profileUid);

          this.dialogRef.close({
            ok: true,
            chatId: result.chatId,
            targetUid: result.targetUid,
            messageId: result.messageId,
          } satisfies ModalMensagemResult);
        },

        error: () => {
          // O erro inesperado já foi encaminhado ao tratamento centralizado.
        },
      });
  }

  fecharModal(): void {
    if (this.isSending()) {
      return;
    }

    this.dialogRef.close();
  }

  private handleUnexpectedError(
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
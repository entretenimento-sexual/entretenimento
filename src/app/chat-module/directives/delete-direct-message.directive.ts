// src/app/chat-module/directives/delete-direct-message.directive.ts
// -----------------------------------------------------------------------------
// DeleteDirectMessageDirective
// -----------------------------------------------------------------------------
// Aciona a Cloud Function deleteDirectMessage para apagar mensagem direta.
//
// Motivo:
// - o cliente não pode executar deleteDoc em chats/{chatId}/messages/{messageId};
// - firestore rules bloqueiam exclusão física;
// - a callable faz validação de autoria/participação e executa soft delete;
// - apagar é destrutivo, então há confirmação explícita antes da chamada.
// -----------------------------------------------------------------------------

import { Directive, HostBinding, HostListener, Input, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';

import { DirectMessageActionsService } from 'src/app/messaging/direct-chat/services/direct-message-actions.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Directive({
  selector: 'button[appDeleteDirectMessage]',
  standalone: false,
})
export class DeleteDirectMessageDirective implements OnDestroy {
  @Input() deleteChatId: string | null | undefined;
  @Input() deleteMessageId: string | null | undefined;

  @HostBinding('attr.aria-busy')
  get ariaBusy(): boolean | null {
    return this.busy ? true : null;
  }

  @HostBinding('attr.aria-label')
  get ariaLabel(): string {
    return this.busy ? 'Apagando mensagem' : 'Apagar mensagem';
  }

  @HostBinding('disabled') busy = false;

  private sub?: Subscription;

  constructor(
    private readonly directMessageActions: DirectMessageActionsService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
  ) {}

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.sub = undefined;
  }

  @HostListener('click', ['$event'])
  onClick(event: Event): void {
    event.stopPropagation();

    if (this.busy) {
      return;
    }

    const chatId = String(this.deleteChatId ?? '').trim();
    const messageId = String(this.deleteMessageId ?? '').trim();

    if (!chatId || !messageId) {
      this.errorNotifier.showError('Não foi possível identificar a mensagem.');
      return;
    }

    if (!this.confirmDelete()) {
      return;
    }

    this.busy = true;
    this.sub?.unsubscribe();

    this.sub = this.directMessageActions.deleteDirectMessage$(chatId, messageId)
      .subscribe({
        next: () => {
          this.busy = false;
        },
        error: (error) => {
          this.busy = false;
          this.errorNotifier.showError('Não foi possível apagar a mensagem.');
          this.reportError(error, chatId, messageId);
        },
      });
  }

  private confirmDelete(): boolean {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      return true;
    }

    return window.confirm('Apagar esta mensagem? Esta ação não pode ser desfeita.');
  }

  private reportError(error: unknown, chatId: string, messageId: string): void {
    try {
      const err = error instanceof Error
        ? error
        : new Error('Falha ao apagar mensagem direta.');

      (err as any).original = error;
      (err as any).context = {
        scope: 'DeleteDirectMessageDirective',
        chatId,
        messageId,
      };
      (err as any).skipUserNotification = true;

      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}

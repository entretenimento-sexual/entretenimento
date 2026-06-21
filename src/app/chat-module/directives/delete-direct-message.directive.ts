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
import { MatDialog } from '@angular/material/dialog';
import { Subscription, of } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';

import { DirectMessageActionsService } from 'src/app/messaging/direct-chat/services/direct-message-actions.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { DeleteMessageConfirmDialogComponent } from '../modals/delete-message-confirm-dialog/delete-message-confirm-dialog.component';

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
    private readonly dialog: MatDialog,
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

    this.sub?.unsubscribe();

    this.sub = this.confirmDelete$()
      .pipe(
        switchMap((confirmed) => {
          if (!confirmed) {
            return of(void 0);
          }

          this.busy = true;
          return this.directMessageActions.deleteDirectMessage$(chatId, messageId);
        }),
        catchError((error) => {
          this.errorNotifier.showError('Não foi possível apagar a mensagem.');
          this.reportError(error, chatId, messageId);
          return of(void 0);
        })
      )
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

  private confirmDelete$() {
    try {
      return this.dialog.open(DeleteMessageConfirmDialogComponent, {
        autoFocus: 'first-tabbable',
        restoreFocus: true,
        disableClose: false,
        panelClass: 'delete-message-confirm-dialog-panel',
      }).afterClosed().pipe(
        take(1),
        switchMap((confirmed) => of(confirmed === true))
      );
    } catch {
      if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
        return of(true);
      }

      return of(window.confirm('Apagar esta mensagem? Esta ação não pode ser desfeita.'));
    }
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

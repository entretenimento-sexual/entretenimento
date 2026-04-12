// src/app/account/components/account-lifecycle-dialog/account-lifecycle-dialog.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  AccountLifecycleDialogConfirmEvent,
  AccountLifecycleDialogIntent,
} from '../../models/account-lifecycle.model';

@Component({
  selector: 'app-account-lifecycle-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './account-lifecycle-dialog.component.html',
  styleUrl: './account-lifecycle-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountLifecycleDialogComponent {
  readonly intent = input.required<AccountLifecycleDialogIntent>();
  readonly busy = input<boolean>(false);

  readonly closed = output<void>();
  readonly confirmed = output<AccountLifecycleDialogConfirmEvent>();

  readonly reason = signal('');
  readonly reasonTouched = signal(false);

  readonly isDanger = computed(() => {
    const intent = this.intent();
    return intent === 'self_delete' || intent === 'moderator_delete';
  });

  readonly requiresReason = computed(() => {
    const intent = this.intent();
    return intent === 'moderator_suspend' || intent === 'moderator_delete';
  });

  readonly title = computed(() => {
    switch (this.intent()) {
      case 'self_suspend':
        return 'Suspender conta';
      case 'self_delete':
        return 'Excluir conta';
      case 'reactivate_self_suspend':
        return 'Reativar conta';
      case 'cancel_pending_deletion':
        return 'Cancelar exclusão';
      case 'moderator_suspend':
        return 'Suspender conta do usuário';
      case 'moderator_delete':
        return 'Excluir conta do usuário';
      default:
        return 'Confirmar ação';
    }
  });

  readonly description = computed(() => {
    switch (this.intent()) {
      case 'self_suspend':
        return 'Sua conta ficará invisível para outras pessoas e todas as interações serão bloqueadas até a reativação.';
      case 'self_delete':
        return 'Sua conta entrará em exclusão pendente, ficará invisível e as interações serão bloqueadas. Ainda haverá uma janela curta para arrependimento.';
      case 'reactivate_self_suspend':
        return 'Sua conta voltará a ficar visível e poderá interagir normalmente na plataforma.';
      case 'cancel_pending_deletion':
        return 'A exclusão pendente será cancelada e sua conta voltará ao estado ativo.';
      case 'moderator_suspend':
        return 'A conta ficará invisível para terceiros, com interações totalmente bloqueadas e acesso redirecionado para a página de status.';
      case 'moderator_delete':
        return 'A conta entrará em exclusão pendente, ficará invisível imediatamente e seguirá para retenção mínima e expurgo posterior.';
      default:
        return 'Confirme a ação.';
    }
  });

  readonly ctaLabel = computed(() => {
    switch (this.intent()) {
      case 'self_suspend':
        return 'Confirmar suspensão';
      case 'self_delete':
        return 'Confirmar exclusão';
      case 'reactivate_self_suspend':
        return 'Reativar conta';
      case 'cancel_pending_deletion':
        return 'Cancelar exclusão';
      case 'moderator_suspend':
        return 'Aplicar suspensão';
      case 'moderator_delete':
        return 'Agendar exclusão';
      default:
        return 'Confirmar';
    }
  });

  readonly reasonLabel = computed(() => {
    switch (this.intent()) {
      case 'moderator_suspend':
      case 'moderator_delete':
        return 'Motivo obrigatório';
      case 'self_suspend':
        return 'Motivo opcional';
      case 'self_delete':
        return 'Motivo opcional';
      default:
        return 'Motivo';
    }
  });

  readonly reasonPlaceholder = computed(() => {
    switch (this.intent()) {
      case 'moderator_suspend':
        return 'Explique de forma objetiva a razão da suspensão.';
      case 'moderator_delete':
        return 'Explique de forma objetiva a razão da exclusão.';
      case 'self_suspend':
        return 'Ex.: pausa pessoal, necessidade de se afastar, discrição.';
      case 'self_delete':
        return 'Ex.: não desejo mais manter a conta.';
      default:
        return 'Descreva o motivo.';
    }
  });

  readonly reasonError = computed(() => {
    if (!this.requiresReason()) return null;
    if (!this.reasonTouched()) return null;

    return this.reason().trim() ? null : 'O motivo é obrigatório para esta ação.';
  });

  readonly canConfirm = computed(() => {
    if (this.busy()) return false;
    if (!this.requiresReason()) return true;
    return this.reason().trim().length > 0;
  });

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.busy()) return;
    this.onClose();
  }

  onBackdropClick(): void {
    if (this.busy()) return;
    this.onClose();
  }

  onDialogClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  onReasonInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement | null;
    this.reason.set(target?.value ?? '');
  }

  onReasonBlur(): void {
    this.reasonTouched.set(true);
  }

  onClose(): void {
    this.closed.emit();
  }

  onConfirm(): void {
    this.reasonTouched.set(true);

    if (!this.canConfirm()) {
      return;
    }

    const payload: AccountLifecycleDialogConfirmEvent = {
      intent: this.intent(),
      reason: this.reason().trim() || null,
    };

    this.confirmed.emit(payload);
  }
}
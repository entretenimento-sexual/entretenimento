// src/app/account/components/account-lifecycle-dialog/account-lifecycle-dialog.component.ts
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';

import { ActionStateDirective } from 'src/app/shared/action-state/action-state.directive';
import {
  AccountLifecycleDialogConfirmEvent,
  AccountLifecycleDialogIntent,
  AccountReauthenticationMode,
} from '../../models/account-lifecycle.model';

@Component({
  selector: 'app-account-lifecycle-dialog',
  standalone: true,
  imports: [CommonModule, A11yModule, ActionStateDirective],
  templateUrl: './account-lifecycle-dialog.component.html',
  styleUrl: './account-lifecycle-dialog.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountLifecycleDialogComponent implements AfterViewInit {
  readonly intent = input.required<AccountLifecycleDialogIntent>();
  readonly busy = input<boolean>(false);
  readonly reauthenticationMode = input<AccountReauthenticationMode>(
    'unsupported'
  );

  readonly closed = output<void>();
  readonly confirmed = output<AccountLifecycleDialogConfirmEvent>();

  readonly reason = signal('');
  readonly reasonTouched = signal(false);
  readonly maxReasonLength = 500;

  readonly password = signal('');
  readonly passwordTouched = signal(false);
  readonly showPassword = signal(false);

  private previousActiveElement: HTMLElement | null = null;

  readonly isDanger = computed(() => {
    const intent = this.intent();
    return intent === 'self_delete' || intent === 'moderator_delete';
  });

  readonly requiresReason = computed(() => {
    const intent = this.intent();
    return intent === 'moderator_suspend' || intent === 'moderator_delete';
  });

  readonly requiresIdentityConfirmation = computed(() => {
    const intent = this.intent();
    return (
      intent === 'self_suspend' ||
      intent === 'self_delete' ||
      intent === 'reactivate_self_suspend' ||
      intent === 'cancel_pending_deletion'
    );
  });

  readonly requiresPassword = computed(
    () =>
      this.requiresIdentityConfirmation() &&
      this.reauthenticationMode() === 'password'
  );

  readonly usesGoogleConfirmation = computed(
    () =>
      this.requiresIdentityConfirmation() &&
      this.reauthenticationMode() === 'google'
  );

  readonly hasUnsupportedConfirmation = computed(
    () =>
      this.requiresIdentityConfirmation() &&
      this.reauthenticationMode() === 'unsupported'
  );

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
        return 'Sua conta ficará invisível e as interações serão bloqueadas até você reativá-la. Uma suspensão aplicada pela moderação não pode ser removida por este fluxo.';
      case 'self_delete':
        return 'Sua conta ficará invisível imediatamente. Você poderá cancelar a solicitação por 24 horas; depois desse prazo, a exclusão definitiva poderá ser iniciada.';
      case 'reactivate_self_suspend':
        return 'A conta voltará ao estado ativo. A visibilidade pública só será restaurada quando as verificações obrigatórias continuarem válidas.';
      case 'cancel_pending_deletion':
        return 'A exclusão pendente será cancelada e o estado que a conta possuía antes da solicitação será restaurado.';
      case 'moderator_suspend':
        return 'A conta ficará invisível para terceiros, com interações bloqueadas e acesso restrito à página de status.';
      case 'moderator_delete':
        return 'A conta entrará em exclusão pendente, ficará invisível imediatamente e seguirá para retenção e expurgo posterior.';
      default:
        return 'Confirme a ação.';
    }
  });

  readonly ctaLabel = computed(() => {
    switch (this.intent()) {
      case 'self_suspend':
        return 'Confirmar suspensão';
      case 'self_delete':
        return 'Solicitar exclusão';
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

  readonly busyCtaLabel = computed(() => {
    switch (this.intent()) {
      case 'self_suspend':
        return 'Suspendendo conta...';
      case 'self_delete':
        return 'Solicitando exclusão...';
      case 'reactivate_self_suspend':
        return 'Reativando conta...';
      case 'cancel_pending_deletion':
        return 'Cancelando exclusão...';
      case 'moderator_suspend':
        return 'Aplicando suspensão...';
      case 'moderator_delete':
        return 'Agendando exclusão...';
      default:
        return 'Processando...';
    }
  });

  readonly reasonLabel = computed(() => {
    switch (this.intent()) {
      case 'moderator_suspend':
      case 'moderator_delete':
        return 'Motivo obrigatório';
      case 'self_suspend':
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
        return 'Ex.: pausa pessoal ou necessidade de discrição.';
      case 'self_delete':
        return 'Ex.: não desejo mais manter a conta.';
      default:
        return 'Descreva o motivo.';
    }
  });

  readonly reasonLength = computed(() => this.reason().length);

  readonly reasonError = computed(() => {
    if (this.reasonLength() > this.maxReasonLength) {
      return `O motivo deve ter no máximo ${this.maxReasonLength} caracteres.`;
    }

    if (!this.requiresReason() || !this.reasonTouched()) return null;
    return this.reason().trim()
      ? null
      : 'O motivo é obrigatório para esta ação.';
  });

  readonly passwordError = computed(() => {
    if (!this.requiresPassword() || !this.passwordTouched()) return null;
    return this.password().length > 0
      ? null
      : 'Informe sua senha atual para confirmar esta ação.';
  });

  readonly canConfirm = computed(() => {
    if (this.busy() || this.reasonLength() > this.maxReasonLength) return false;
    if (this.requiresReason() && !this.reason().trim()) return false;
    if (this.hasUnsupportedConfirmation()) return false;
    if (this.requiresPassword() && !this.password()) return false;
    return true;
  });

  ngAfterViewInit(): void {
    if (typeof document !== 'undefined') {
      this.previousActiveElement = document.activeElement as HTMLElement | null;
    }
  }

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

  onPasswordInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.password.set(target?.value ?? '');
  }

  onPasswordBlur(): void {
    this.passwordTouched.set(true);
  }

  togglePasswordVisibility(): void {
    if (this.busy()) return;
    this.showPassword.update((visible) => !visible);
  }

  onClose(): void {
    const focusTarget = this.previousActiveElement;
    this.previousActiveElement = null;
    this.password.set('');
    this.closed.emit();

    if (focusTarget?.isConnected) {
      setTimeout(() => focusTarget.focus(), 0);
    }
  }

  onConfirm(): void {
    this.reasonTouched.set(true);
    this.passwordTouched.set(true);

    if (!this.canConfirm()) return;

    this.confirmed.emit({
      intent: this.intent(),
      reason: this.reason().trim() || null,
      password: this.requiresPassword() ? this.password() : null,
    });
  }
}

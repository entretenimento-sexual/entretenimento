// src/app/core/services/autentication/email-input-modal.service.ts
// -----------------------------------------------------------------------------
// EmailInputModalService
// -----------------------------------------------------------------------------
// Responsabilidade:
// - controlar abertura/fechamento do modal de recuperação de senha;
// - validar e-mail antes de chamar Firebase Auth;
// - expor estado reativo para a UI;
// - usar feedback neutro para evitar enumeração de contas.
// -----------------------------------------------------------------------------
import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { finalize, take } from 'rxjs/operators';

import { LoginService } from '../autentication/login.service';

export type PasswordRecoveryFeedbackType = 'info' | 'success' | 'error';

export interface PasswordRecoveryFeedback {
  type: PasswordRecoveryFeedbackType;
  message: string;
}

export interface PasswordRecoveryModalState {
  isOpen: boolean;
  email: string;
  isSending: boolean;
  feedback: PasswordRecoveryFeedback | null;
}

@Injectable({ providedIn: 'root' })
export class EmailInputModalService {
  /**
   * Mantidos por compatibilidade com usos/specs antigos.
   * Novo fluxo deve preferir state$.
   */
  public readonly isModalOpen = new Subject<boolean>();
  public readonly emailSentMessage = new Subject<string>();

  private readonly neutralRecoveryMessage =
    'Se esse e-mail estiver cadastrado, enviaremos as instruções de recuperação.';

  private readonly stateSubject = new BehaviorSubject<PasswordRecoveryModalState>({
    isOpen: false,
    email: '',
    isSending: false,
    feedback: null,
  });

  readonly state$ = this.stateSubject.asObservable();

  constructor(private readonly loginService: LoginService) {}

  openModal(initialEmail = ''): void {
    const email = (initialEmail ?? '').trim();

    this.patchState({
      isOpen: true,
      email,
      isSending: false,
      feedback: null,
    });

    this.isModalOpen.next(true);
  }

  closeModal(): void {
    this.patchState({
      isOpen: false,
      isSending: false,
      feedback: null,
    });

    this.isModalOpen.next(false);
  }

  updateEmail(email: string): void {
    this.patchState({ email: email ?? '' });
  }

  /**
   * Envia o e-mail de recuperação de senha.
   *
   * A mensagem de sucesso é propositalmente neutra:
   * - não confirma se a conta existe;
   * - reduz enumeração de e-mails;
   * - funciona melhor no emulador, onde não há entrega real para Gmail.
   */
  sendPasswordRecoveryEmail(email: string): void {
    const safeEmail = (email ?? '').trim().toLowerCase();

    if (!this.isValidEmail(safeEmail)) {
      this.setFeedback('error', 'Informe um e-mail válido para continuar.');
      return;
    }

    this.patchState({
      email: safeEmail,
      isSending: true,
      feedback: {
        type: 'info',
        message: 'Preparando envio das instruções...',
      },
    });

    this.loginService.sendPasswordResetEmail$(safeEmail).pipe(
      take(1),
      finalize(() => this.patchState({ isSending: false }))
    ).subscribe({
      next: () => {
        this.setFeedback('success', this.neutralRecoveryMessage);
      },
      error: (error) => {
        /**
         * Para evitar enumeração, auth/user-not-found recebe o mesmo feedback neutro.
         * Erros técnicos reais continuam com mensagem genérica de falha operacional.
         */
        if (this.isAccountLookupError(error)) {
          this.setFeedback('success', this.neutralRecoveryMessage);
          return;
        }

        this.setFeedback(
          'error',
          'Não foi possível solicitar a recuperação agora. Verifique sua conexão e tente novamente.'
        );
      },
    });
  }

  private patchState(patch: Partial<PasswordRecoveryModalState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch,
    });
  }

  private setFeedback(type: PasswordRecoveryFeedbackType, message: string): void {
    this.patchState({
      feedback: { type, message },
    });

    this.emailSentMessage.next(message);
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private isAccountLookupError(error: unknown): boolean {
    const code = String((error as { code?: unknown })?.code ?? '').toLowerCase();

    return (
      code === 'auth/user-not-found' ||
      code === 'auth/email-not-found' ||
      code === 'auth/invalid-email'
    );
  }
}

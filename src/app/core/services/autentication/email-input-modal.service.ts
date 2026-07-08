// src/app/core/services/autentication/email-input-modal.service.ts
// -----------------------------------------------------------------------------
// EmailInputModalService
// -----------------------------------------------------------------------------
// Responsabilidade:
// - controlar abertura/fechamento do modal de recuperação de senha;
// - validar e-mail antes de chamar Firebase Auth;
// - expor estado reativo para a UI;
// - usar feedback neutro para evitar enumeração de contas;
// - diferenciar a orientação de produção da orientação do Auth Emulator.
// -----------------------------------------------------------------------------
import { Injectable, isDevMode } from '@angular/core';
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
  requestCompleted: boolean;
  submittedEmail: string | null;
  isLocalDev: boolean;
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

  private readonly productionSuccessMessage =
    'Solicitação enviada. Se esse e-mail estiver cadastrado, as instruções chegarão na caixa de entrada. Verifique também o spam.';

  private readonly emulatorSuccessMessage =
    'Solicitação registrada no Auth Emulator. O emulador não envia e-mail real; copie o link de redefinição impresso no terminal dos emuladores.';

  private readonly stateSubject = new BehaviorSubject<PasswordRecoveryModalState>({
    isOpen: false,
    email: '',
    isSending: false,
    requestCompleted: false,
    submittedEmail: null,
    isLocalDev: isDevMode(),
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
      requestCompleted: false,
      submittedEmail: null,
      feedback: null,
    });

    this.isModalOpen.next(true);
  }

  closeModal(): void {
    this.patchState({
      isOpen: false,
      isSending: false,
      requestCompleted: false,
      submittedEmail: null,
      feedback: null,
    });

    this.isModalOpen.next(false);
  }

  updateEmail(email: string): void {
    const nextEmail = email ?? '';
    const normalizedNextEmail = this.normalizeEmail(nextEmail);
    const currentState = this.stateSubject.value;
    const changedAfterCompletedRequest =
      currentState.requestCompleted && normalizedNextEmail !== currentState.submittedEmail;

    this.patchState({
      email: nextEmail,
      requestCompleted: changedAfterCompletedRequest ? false : currentState.requestCompleted,
      submittedEmail: changedAfterCompletedRequest ? null : currentState.submittedEmail,
      feedback: changedAfterCompletedRequest ? null : currentState.feedback,
    });
  }

  /**
   * Envia o e-mail de recuperação de senha.
   *
   * A mensagem de sucesso é propositalmente neutra:
   * - não confirma se a conta existe;
   * - reduz enumeração de e-mails;
   * - evita que o usuário clique repetidas vezes para o mesmo endereço;
   * - no emulador, explica que não há entrega real para Gmail.
   */
  sendPasswordRecoveryEmail(email: string): void {
    const safeEmail = this.normalizeEmail(email);

    if (!this.isValidEmail(safeEmail)) {
      this.setFeedback('error', 'Informe um e-mail válido para continuar.');
      return;
    }

    const currentState = this.stateSubject.value;

    if (currentState.requestCompleted && currentState.submittedEmail === safeEmail) {
      return;
    }

    this.patchState({
      email: safeEmail,
      isSending: true,
      requestCompleted: false,
      submittedEmail: null,
      feedback: {
        type: 'info',
        message: 'Enviando solicitação de recuperação...',
      },
    });

    this.loginService.sendPasswordResetEmail$(safeEmail).pipe(
      take(1),
      finalize(() => this.patchState({ isSending: false }))
    ).subscribe({
      next: () => {
        this.handleRecoveryRequestAccepted(safeEmail);
      },
      error: (error) => {
        /**
         * Para evitar enumeração, auth/user-not-found recebe o mesmo feedback neutro.
         * Erros técnicos reais continuam com mensagem genérica de falha operacional.
         */
        if (this.isAccountLookupError(error)) {
          this.handleRecoveryRequestAccepted(safeEmail);
          return;
        }

        this.setFeedback(
          'error',
          'Não foi possível solicitar a recuperação agora. Verifique sua conexão e tente novamente.'
        );
      },
    });
  }

  private handleRecoveryRequestAccepted(email: string): void {
    const message = this.getSuccessMessage();

    this.patchState({
      requestCompleted: true,
      submittedEmail: email,
      feedback: { type: 'success', message },
    });

    this.emailSentMessage.next(message);
  }

  private getSuccessMessage(): string {
    return isDevMode() ? this.emulatorSuccessMessage : this.productionSuccessMessage;
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

  private normalizeEmail(email: string): string {
    return (email ?? '').trim().toLowerCase();
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

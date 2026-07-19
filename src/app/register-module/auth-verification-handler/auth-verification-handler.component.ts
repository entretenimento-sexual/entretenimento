// src/app/authentication/auth-verification-handler/auth-verification-handler.component.ts
// -----------------------------------------------------------------------------
// AuthVerificationHandlerComponent
// -----------------------------------------------------------------------------
// Responsabilidade exclusiva:
// - processar links de verificação de e-mail;
// - validar e processar links de redefinição de senha;
// - exibir feedback para link inválido, expirado, já utilizado ou indisponível.
//
// Este componente NÃO deve:
// - completar perfil;
// - gravar profileCompleted;
// - gravar gender/orientation/estado/municipio;
// - fazer upload de avatar;
// - decidir onboarding.
// -----------------------------------------------------------------------------
import { Component, OnDestroy, OnInit, NgZone } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  EmailVerificationService,
  VerifyEmailResult,
} from 'src/app/core/services/autentication/register/email-verification.service';
import {
  PasswordResetCodeValidationResult,
  PasswordResetCodeValidationService,
} from 'src/app/core/services/autentication/password-reset-code-validation.service';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ValidatorService } from 'src/app/core/services/general/validator.service';

import { EmailInputModalComponent } from 'src/app/authentication/email-input-modal/email-input-modal.component';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';

import { EMPTY, Subject, firstValueFrom } from 'rxjs';
import {
  catchError,
  finalize,
  take,
  takeUntil,
  tap,
  timeout,
} from 'rxjs/operators';

type HandlerMode = 'verifyEmail' | 'resetPassword' | '';

@Component({
  selector: 'app-auth-verification-handler',
  templateUrl: './auth-verification-handler.component.html',
  styleUrls: ['./auth-verification-handler.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    EmailInputModalComponent,
  ],
})
export class AuthVerificationHandlerComponent implements OnInit, OnDestroy {
  public isLoading = true;

  public mode: HandlerMode = '';
  public oobCode = '';
  public message = '';

  public verifyOk = false;
  public showResendVerifyCTA = false;
  public showGoToLoginCTA = false;

  public newPassword = '';
  public confirmPassword = '';
  public showPassword = false;
  public showConfirmPassword = false;
  public shouldShowRecoveryLink = false;
  public passwordResetOk = false;
  public passwordResetCompleted = false;
  public passwordResetUnavailable = false;
  public passwordResetCodeValidated = false;
  public passwordResetValidationRetryAvailable = false;
  public passwordResetTargetEmail = '';

  private readonly ngUnsubscribe = new Subject<void>();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly ngZone: NgZone,

    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordResetCodeValidation: PasswordResetCodeValidationService,
    private readonly loginService: LoginService,
    private readonly globalErrorHandlerService: GlobalErrorHandlerService,
    private readonly emailInputModalService: EmailInputModalService
  ) {}

  get actionSucceeded(): boolean {
    return this.mode === 'verifyEmail' ? this.verifyOk : this.passwordResetOk;
  }

  get canSubmitPasswordReset(): boolean {
    return (
      !this.isLoading &&
      this.passwordResetCodeValidated &&
      !this.passwordResetCompleted &&
      !this.passwordResetUnavailable &&
      ValidatorService.isValidPassword(this.newPassword, 8) &&
      this.newPassword === this.confirmPassword
    );
  }

  ngOnInit(): void {
    this.route.queryParams
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe((params) => {
        const modeFromQuery = (params['mode'] as HandlerMode) ?? '';
        const codeFromQuery = (params['oobCode'] as string | undefined) ?? '';

        this.resetActionState();
        this.mode = modeFromQuery;
        this.oobCode = codeFromQuery;

        if (!this.mode) {
          this.message = 'Ação desconhecida.';
          this.isLoading = false;
          return;
        }

        if (!this.oobCode) {
          this.message = 'Código inválido ou ausente.';
          this.passwordResetUnavailable = this.mode === 'resetPassword';
          this.shouldShowRecoveryLink = this.mode === 'resetPassword';
          this.isLoading = false;
          return;
        }

        if (this.mode === 'verifyEmail') {
          this.processVerifyEmail();
          return;
        }

        if (this.mode === 'resetPassword') {
          this.isLoading = false;
          this.processPasswordResetLink();
          return;
        }

        this.message = 'Ação desconhecida.';
        this.isLoading = false;
      });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  private processVerifyEmail(): void {
    this.isLoading = true;

    this.emailVerificationService
      .handleEmailVerification()
      .pipe(take(1), takeUntil(this.ngUnsubscribe))
      .subscribe({
        next: (res: VerifyEmailResult) => {
          this.isLoading = false;

          if (res.ok) {
            this.verifyOk = true;

            if (res.reason === 'not-logged-in') {
              this.message =
                'Seu e-mail foi verificado. Faça login para continuar.';
              this.showGoToLoginCTA = true;
              this.showResendVerifyCTA = false;
              return;
            }

            this.message = res.firestoreUpdated
              ? 'E-mail verificado com sucesso.'
              : 'E-mail verificado. A sincronização do perfil será atualizada automaticamente.';

            this.showGoToLoginCTA = false;
            this.showResendVerifyCTA = false;

            this.ngZone.run(() => {
              setTimeout(() => {
                this.router
                  .navigate(['/register/welcome'], {
                    queryParams: { autocheck: '1' },
                    replaceUrl: true,
                  })
                  .catch(() => {});
              }, 1200);
            });

            return;
          }

          this.verifyOk = false;
          this.showGoToLoginCTA = false;

          switch (res.reason) {
            case 'expired':
              this.message =
                'O link de verificação expirou. Reenvie um novo e-mail.';
              this.showResendVerifyCTA = true;
              break;

            case 'invalid':
              this.message =
                'O link de verificação é inválido ou já foi utilizado.';
              this.showResendVerifyCTA = true;
              break;

            case 'not-verified':
              this.message =
                'Quase lá. Processamos o link, mas sua sessão ainda não refletiu a verificação.';
              this.showResendVerifyCTA = true;
              break;

            default:
              this.message = 'Não foi possível verificar seu e-mail agora.';
              this.showResendVerifyCTA = true;
          }
        },

        error: (err) => {
          this.isLoading = false;
          this.verifyOk = false;
          this.showResendVerifyCTA = true;
          this.message = 'Erro ao verificar o e-mail.';
          this.globalErrorHandlerService.handleError(err);
        },
      });
  }

  private processPasswordResetLink(): void {
    if (this.mode !== 'resetPassword' || !this.oobCode || this.isLoading) {
      return;
    }

    this.isLoading = true;
    this.message = '';
    this.passwordResetCodeValidated = false;
    this.passwordResetUnavailable = false;
    this.passwordResetValidationRetryAvailable = false;
    this.shouldShowRecoveryLink = false;
    this.passwordResetTargetEmail = '';

    this.passwordResetCodeValidation
      .validate$(this.oobCode)
      .pipe(take(1), takeUntil(this.ngUnsubscribe))
      .subscribe({
        next: (result) => this.applyPasswordResetCodeValidation(result),
        error: (error: unknown) => {
          this.applyPasswordResetCodeValidation({
            ok: false,
            reason: 'unavailable',
            message:
              'Não foi possível validar o link agora. Verifique sua conexão e tente novamente.',
          });

          const operationalError = new Error(
            '[AuthVerificationHandler] Falha inesperada ao validar link de redefinição.'
          ) as Error & {
            original?: unknown;
            skipUserNotification?: boolean;
          };
          operationalError.original = error;
          operationalError.skipUserNotification = true;
          this.globalErrorHandlerService.handleError(operationalError);
        },
      });
  }

  private applyPasswordResetCodeValidation(
    result: PasswordResetCodeValidationResult
  ): void {
    this.isLoading = false;
    this.passwordResetCodeValidated = result.ok;
    this.passwordResetUnavailable = !result.ok;
    this.passwordResetTargetEmail = result.ok ? result.email ?? '' : '';

    if (result.ok) {
      this.message = '';
      this.shouldShowRecoveryLink = false;
      this.passwordResetValidationRetryAvailable = false;
      return;
    }

    this.message = result.message;
    this.shouldShowRecoveryLink = true;
    this.passwordResetValidationRetryAvailable =
      result.reason === 'unavailable';
  }

  retryPasswordResetValidation(): void {
    if (
      this.mode !== 'resetPassword' ||
      !this.oobCode ||
      this.isLoading ||
      !this.passwordResetValidationRetryAvailable
    ) {
      return;
    }

    this.processPasswordResetLink();
  }

  resendVerificationEmail(): void {
    if (this.isLoading) return;

    this.isLoading = true;

    this.emailVerificationService
      .resendVerificationEmail()
      .pipe(
        take(1),
        timeout({ first: 15_000 }),
        tap((txt) => {
          this.message =
            txt ||
            'E-mail reenviado. Verifique sua caixa de entrada e spam.';
          this.verifyOk = false;
          this.showResendVerifyCTA = false;
        }),
        catchError((err) => {
          this.message = 'Falha ao reenviar o e-mail de verificação.';
          this.globalErrorHandlerService.handleError(err);
          return EMPTY;
        }),
        finalize(() => {
          this.isLoading = false;
        }),
        takeUntil(this.ngUnsubscribe)
      )
      .subscribe();
  }

  goToLogin(): void {
    this.router.navigate(['/login']).catch(() => {});
  }

  goToWelcome(): void {
    this.router
      .navigate(['/register/welcome'], {
        queryParams: { autocheck: '1' },
        replaceUrl: true,
      })
      .catch(() => {});
  }

  async onSubmit(): Promise<void> {
    if (this.mode === 'resetPassword') {
      await this.resetPassword();
    }
  }

  async resetPassword(): Promise<void> {
    if (
      this.mode !== 'resetPassword' ||
      !this.passwordResetCodeValidated ||
      this.passwordResetCompleted ||
      this.passwordResetUnavailable
    ) {
      return;
    }

    this.isLoading = true;
    this.shouldShowRecoveryLink = false;
    this.passwordResetOk = false;

    if (this.newPassword !== this.confirmPassword) {
      this.message = 'As senhas não coincidem.';
      this.isLoading = false;
      return;
    }

    if (!ValidatorService.isValidPassword(this.newPassword, 8)) {
      this.message =
        'Use ao menos 8 caracteres, com letra maiúscula, minúscula e número.';
      this.isLoading = false;
      return;
    }

    try {
      await firstValueFrom(
        this.loginService.confirmPasswordReset$(
          this.oobCode,
          this.newPassword
        )
      );

      this.passwordResetOk = true;
      this.passwordResetCompleted = true;
      this.passwordResetUnavailable = false;
      this.passwordResetCodeValidated = false;
      this.passwordResetValidationRetryAvailable = false;
      this.message =
        'Senha redefinida com sucesso. Redirecionando para o login...';
      this.newPassword = '';
      this.confirmPassword = '';

      this.ngZone.run(() => {
        setTimeout(() => {
          this.router.navigate(['/login']).catch(() => {});
        }, 1500);
      });
    } catch (error: unknown) {
      this.handlePasswordResetError(error);
    } finally {
      this.isLoading = false;
    }
  }

  private handlePasswordResetError(error: unknown): void {
    const code = String((error as { code?: unknown })?.code ?? '');
    const resetErrors = [
      'auth/expired-action-code',
      'auth/invalid-action-code',
    ];

    this.passwordResetOk = false;
    this.shouldShowRecoveryLink = true;

    if (resetErrors.includes(code)) {
      this.passwordResetUnavailable = true;
      this.passwordResetCodeValidated = false;
      this.passwordResetValidationRetryAvailable = false;
      this.message =
        code === 'auth/expired-action-code'
          ? 'O link de redefinição de senha expirou.'
          : 'O código de redefinição é inválido ou já foi usado.';
      return;
    }

    this.passwordResetUnavailable = false;
    this.passwordResetValidationRetryAvailable = false;
    this.message =
      'Não foi possível redefinir a senha agora. Tente novamente.';

    const operationalError = new Error(
      '[AuthVerificationHandler] Falha técnica ao redefinir senha.'
    );
    (operationalError as any).original = error;
    (operationalError as any).context = 'password-reset-confirmation';
    (operationalError as any).skipUserNotification = true;
    this.globalErrorHandlerService.handleError(operationalError);
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  openPasswordRecoveryModal(): void {
    this.emailInputModalService.openModal();
  }

  private resetActionState(): void {
    this.isLoading = true;
    this.message = '';
    this.verifyOk = false;
    this.showResendVerifyCTA = false;
    this.showGoToLoginCTA = false;
    this.newPassword = '';
    this.confirmPassword = '';
    this.showPassword = false;
    this.showConfirmPassword = false;
    this.shouldShowRecoveryLink = false;
    this.passwordResetOk = false;
    this.passwordResetCompleted = false;
    this.passwordResetUnavailable = false;
    this.passwordResetCodeValidated = false;
    this.passwordResetValidationRetryAvailable = false;
    this.passwordResetTargetEmail = '';
  }
}

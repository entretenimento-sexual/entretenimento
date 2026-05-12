// src/app/authentication/auth-verification-handler/auth-verification-handler.component.ts
// -----------------------------------------------------------------------------
// AuthVerificationHandlerComponent
// -----------------------------------------------------------------------------
//
// Responsabilidade exclusiva:
// - processar links de verificação de e-mail;
// - processar links de redefinição de senha;
// - exibir feedback para link inválido, expirado ou já utilizado.
//
// Este componente NÃO deve:
// - completar perfil;
// - gravar profileCompleted;
// - gravar gender/orientation/estado/municipio;
// - fazer upload de avatar;
// - decidir onboarding.
//
// Separação correta:
// - Verificar e-mail grava somente emailVerified.
// - Completar perfil grava somente profileCompleted e dados mínimos do perfil.

import { Component, OnDestroy, OnInit, NgZone } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  EmailVerificationService,
  VerifyEmailResult,
} from 'src/app/core/services/autentication/register/email-verification.service';

import { LoginService } from 'src/app/core/services/autentication/login.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

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

  private readonly ngUnsubscribe = new Subject<void>();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly ngZone: NgZone,

    private readonly emailVerificationService: EmailVerificationService,
    private readonly loginService: LoginService,
    private readonly globalErrorHandlerService: GlobalErrorHandlerService,
    private readonly emailInputModalService: EmailInputModalService
  ) {}

  ngOnInit(): void {
    this.route.queryParams
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe((params) => {
        const modeFromQuery = (params['mode'] as HandlerMode) ?? '';
        const codeFromQuery = (params['oobCode'] as string | undefined) ?? '';

        this.mode = modeFromQuery;
        this.oobCode = codeFromQuery;

        if (!this.mode) {
          this.message = 'Ação desconhecida.';
          this.isLoading = false;
          return;
        }

        if (!this.oobCode) {
          this.message = 'Código inválido ou ausente.';
          this.isLoading = false;
          return;
        }

        if (this.mode === 'verifyEmail') {
          this.processVerifyEmail();
          return;
        }

        if (this.mode === 'resetPassword') {
          /**
           * Reset de senha só é executado após submit do usuário.
           * Não chamamos confirmPasswordReset automaticamente.
           */
          this.isLoading = false;
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

  /**
   * Processa exclusivamente a verificação de e-mail.
   *
   * O service chamado deve atualizar apenas emailVerified.
   * Não deve atualizar profileCompleted.
   */
  private processVerifyEmail(): void {
    this.isLoading = true;

    this.emailVerificationService
      .handleEmailVerification()
      .pipe(
        take(1),
        takeUntil(this.ngUnsubscribe)
      )
      .subscribe({
        next: (res: VerifyEmailResult) => {
          this.isLoading = false;

          if (res.ok) {
            this.verifyOk = true;

            if (res.reason === 'not-logged-in') {
              this.message = 'Seu e-mail foi verificado. Faça login para continuar.';
              this.showGoToLoginCTA = true;
              this.showResendVerifyCTA = false;
              return;
            }

            this.message = res.firestoreUpdated
              ? 'E-mail verificado com sucesso.'
              : 'E-mail verificado. A sincronização do perfil será atualizada automaticamente.';

            this.showGoToLoginCTA = false;
            this.showResendVerifyCTA = false;

            /**
             * Após verificar o e-mail, não mandamos automaticamente para finalizar
             * cadastro nem marcamos perfil como completo.
             *
             * A navegação posterior será decidida pelos guards/gates com base nos
             * dois estados separados:
             * - emailVerified
             * - profileCompleted
             */
            this.ngZone.run(() => {
              setTimeout(() => {
                this.router.navigate(['/register/welcome'], {
                  queryParams: { autocheck: '1' },
                  replaceUrl: true,
                }).catch(() => {});
              }, 1200);
            });

            return;
          }

          this.verifyOk = false;
          this.showGoToLoginCTA = false;

          switch (res.reason) {
            case 'expired':
              this.message = 'O link de verificação expirou. Reenvie um novo e-mail.';
              this.showResendVerifyCTA = true;
              break;

            case 'invalid':
              this.message = 'O link de verificação é inválido ou já foi utilizado.';
              this.showResendVerifyCTA = true;
              break;

            case 'not-verified':
              this.message = 'Quase lá. Processamos o link, mas sua sessão ainda não refletiu a verificação.';
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

  resendVerificationEmail(): void {
    if (this.isLoading) return;

    this.isLoading = true;

    this.emailVerificationService
      .resendVerificationEmail()
      .pipe(
        take(1),
        timeout({ first: 15_000 }),
        tap((txt) => {
          this.message = txt || 'E-mail reenviado. Verifique sua caixa de entrada e spam.';
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
    this.router.navigate(['/register/welcome'], {
      queryParams: { autocheck: '1' },
      replaceUrl: true,
    }).catch(() => {});
  }

  async onSubmit(): Promise<void> {
    if (this.mode === 'resetPassword') {
      await this.resetPassword();
    }
  }

  async resetPassword(): Promise<void> {
    if (this.mode !== 'resetPassword') return;

    this.isLoading = true;
    this.shouldShowRecoveryLink = false;

    if (this.newPassword !== this.confirmPassword) {
      this.message = 'As senhas não coincidem.';
      this.isLoading = false;
      return;
    }

    if (this.newPassword.length < 8) {
      this.message = 'A senha deve ter pelo menos 8 caracteres.';
      this.isLoading = false;
      return;
    }

    try {
      await firstValueFrom(
        this.loginService.confirmPasswordReset$(this.oobCode, this.newPassword)
      );

      this.message = 'Senha redefinida com sucesso. Redirecionando para o login...';
      this.newPassword = '';
      this.confirmPassword = '';

      this.ngZone.run(() => {
        setTimeout(() => {
          this.router.navigate(['/login']).catch(() => {});
        }, 1500);
      });
    } catch (error: any) {
      this.handlePasswordResetError(error);
    } finally {
      this.isLoading = false;
    }
  }

  private handlePasswordResetError(error: any): void {
    const code = error?.code;
    const resetErrors = ['auth/expired-action-code', 'auth/invalid-action-code'];

    if (resetErrors.includes(code)) {
      this.shouldShowRecoveryLink = true;
      this.message =
        code === 'auth/expired-action-code'
          ? 'O link de redefinição de senha expirou.'
          : 'O código de redefinição é inválido ou já foi usado.';
      return;
    }

    this.shouldShowRecoveryLink = true;
    this.message = 'Erro ao redefinir a senha.';
  }

  redirectToFAQ(): void {
    this.router.navigate(['/faq']).catch(() => {});
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
} // Linha 346
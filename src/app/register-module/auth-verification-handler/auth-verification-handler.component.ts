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
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  EmailVerificationService,
  VerifyEmailResult,
} from 'src/app/core/services/autentication/register/email-verification.service';
import {
  PasswordResetCodeValidationResult,
  PasswordResetCodeValidationService,
} from 'src/app/core/services/autentication/password-reset-code-validation.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { LogoutService } from '@core/services/autentication/auth/logout.service';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ValidatorService } from 'src/app/core/services/general/validator.service';

import { EmailInputModalComponent } from 'src/app/authentication/email-input-modal/email-input-modal.component';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';

import { EMPTY, Subject, defer, firstValueFrom } from 'rxjs';
import {
  catchError,
  finalize,
  map,
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    EmailInputModalComponent,
  ],
})
export class AuthVerificationHandlerComponent implements OnInit, OnDestroy {
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly location = inject(Location);
  public isLoading = true;

  public mode: HandlerMode = '';
  public oobCode = '';
  public message = '';
  public navigationError = '';

  public verifyOk = false;
  public canConfirmVerification = false;
  public canRetryVerification = false;
  public canSwitchAccount = false;
  private verifiedUser: AuthSessionService['currentAuthUser'] = null;
  private verifiedSession?: number;
  private readonly actionChanged = new Subject<void>();
  public showGoToLoginCTA = false;

  public newPassword = '';
  public confirmPassword = '';
  public showPassword = false;
  public showConfirmPassword = false;
  public confirmationTouched = false;
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

    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordResetCodeValidation: PasswordResetCodeValidationService,
    private readonly loginService: LoginService,
    private readonly globalErrorHandlerService: GlobalErrorHandlerService,
    private readonly emailInputModalService: EmailInputModalService,
    private readonly session: AuthSessionService,
    private readonly logout: LogoutService
  ) {}

  get passwordMismatch(): boolean {
    return this.confirmationTouched && this.newPassword !== this.confirmPassword;
  }

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
        const mode = params['mode'];
        const modeFromQuery: HandlerMode = mode === 'verifyEmail' || mode === 'resetPassword' ? mode : '';
        const codeFromQuery = typeof params['oobCode'] === 'string' ? params['oobCode'].trim() : '';

        this.actionChanged.next();
        this.resetActionState();
        this.mode = modeFromQuery;
        this.oobCode = codeFromQuery;
        if (params['oobCode'] !== undefined) {
          const path = this.router.url?.split(/[?#]/, 1)[0] || '/__/auth/action';
          this.location.replaceState(path, modeFromQuery ? 'mode=' + modeFromQuery : '');
        }

        if (!this.mode) {
          this.message = 'Ação desconhecida.';
          this.setLoading(false);
          return;
        }

        if (!this.oobCode) {
          this.message = 'Reabra o link recebido por e-mail ou solicite um novo.';
          this.passwordResetUnavailable = this.mode === 'resetPassword';
          this.shouldShowRecoveryLink = this.mode === 'resetPassword';
          this.showGoToLoginCTA = this.mode === 'verifyEmail';
          this.setLoading(false);
          return;
        }

        if (this.mode === 'verifyEmail') {
          this.canConfirmVerification = true;
          this.setLoading(false);
          return;
        }

        if (this.mode === 'resetPassword') {
          this.isLoading = false;
          this.processPasswordResetLink();
          return;
        }

        this.message = 'Ação desconhecida.';
        this.setLoading(false);
      });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
    this.actionChanged.complete();
    this.oobCode = '';
  }

  confirmEmailVerification(): void {
    if (this.isLoading || !this.canConfirmVerification || this.mode !== 'verifyEmail') return;

    this.canConfirmVerification = false;
    this.processVerifyEmail();
  }

  private processVerifyEmail(): void {
    this.setLoading(true);
    this.emailVerificationService.handleEmailVerification(this.oobCode)
      .pipe(
        take(1),
        takeUntil(this.actionChanged),
        takeUntil(this.ngUnsubscribe)
      )
      .subscribe({
        next: (result) => this.applyVerificationResult(result),
        error: (error: unknown) => {
          this.applyVerificationResult({ ok: false, reason: 'unavailable' });
          this.globalErrorHandlerService.handleError(Object.assign(
            new Error('Falha inesperada ao processar o link de verificação.'), { cause: error, silent: true }
          ));
        },
      });
  }

  private applyVerificationResult(result: VerifyEmailResult): void {
    this.setLoading(false);
    this.verifyOk = result.ok;
    const activeUser = this.session.currentAuthUser;
    this.verifiedUser = activeUser && activeUser.uid === result.verifiedUid ? activeUser : null;
    this.verifiedSession = this.session.terminationVersionSnapshot;
    this.canRetryVerification = result.reason === 'unavailable';
    if (!this.canRetryVerification) this.oobCode = '';
    this.canSwitchAccount = result.reason === 'different-account' ||
      ((result.reason === 'expired' || result.reason === 'invalid') && !!this.session.currentAuthUser);
    this.showGoToLoginCTA = !this.canSwitchAccount &&
      ((!result.ok && !this.session.currentAuthUser) || result.reason === 'not-logged-in');

    switch (result.reason) {
      case 'different-account':
        this.message = 'O e-mail do link foi confirmado. Para continuar, entre com a conta que recebeu o link.';
        break;
      case 'not-logged-in':
        this.message = 'Seu e-mail foi verificado. Faça login para continuar.';
        break;
      case 'expired':
        this.message = 'O link de verificação expirou. Entre na conta que recebeu o link para solicitar outro.';
        break;
      case 'invalid':
        this.message = 'O link é inválido ou já foi usado. Entre na sua conta para conferir a verificação.';
        break;
      case 'unavailable':
        this.message = 'Não foi possível confirmar o resultado do link agora. Verifique a conexão e tente novamente.';
        break;
      case 'sync-pending':
      case 'not-verified':
        this.message = 'E-mail confirmado. A atualização dos dados da conta ainda está pendente.';
        break;
      default:
        this.message = result.ok ? 'E-mail verificado com sucesso.' : 'Não foi possível verificar seu e-mail agora.';
    }
  }

  retryEmailVerification(): void {
    if (!this.isLoading && this.canRetryVerification) this.processVerifyEmail();
  }

  switchVerificationAccount(): void {
    if (this.isLoading || !this.canSwitchAccount) return;
    if (!this.session.currentAuthUser) {
      this.goToLogin();
      return;
    }

    this.setLoading(true);
    this.logout.logout$().pipe(
      take(1),
      catchError(() => EMPTY),
      finalize(() => this.setLoading(false)),
      takeUntil(this.actionChanged),
      takeUntil(this.ngUnsubscribe)
    ).subscribe();
  }

  private processPasswordResetLink(): void {
    if (this.mode !== 'resetPassword' || !this.oobCode || this.isLoading) {
      return;
    }

    this.setLoading(true);
    this.message = '';
    this.passwordResetCodeValidated = false;
    this.passwordResetUnavailable = false;
    this.passwordResetValidationRetryAvailable = false;
    this.shouldShowRecoveryLink = false;
    this.passwordResetTargetEmail = '';

    this.passwordResetCodeValidation
      .validate$(this.oobCode)
      .pipe(take(1), takeUntil(this.actionChanged), takeUntil(this.ngUnsubscribe))
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
    this.setLoading(false);
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

  goToLogin(): void {
    this.navigateAfterVerification(['/login']);
  }

  goToWelcome(): void {
    if (!this.verifiedUser || this.session.currentAuthUser !== this.verifiedUser ||
        this.session.isTerminatingSnapshot || this.session.terminationVersionSnapshot !== this.verifiedSession) {
      this.applyVerificationResult({
        ok: true,
        reason: this.session.currentAuthUser ? 'different-account' : 'not-logged-in',
      });
      return;
    }
    this.navigateAfterVerification(['/register/welcome'], { autocheck: '1' });
  }

  private navigateAfterVerification(commands: string[], queryParams?: Record<string, string>): void {
    if (this.isLoading) return;
    this.navigationError = '';
    this.setLoading(true);

    defer(() => this.router.navigate(commands, { queryParams, replaceUrl: true })).pipe(
      timeout({ first: 15_000 }),
      map((navigated) => {
        if (!navigated) throw new Error('A navegação foi interrompida.');
      }),
      catchError((error: unknown) => {
        this.navigationError = 'Não foi possível abrir a próxima tela. Tente novamente.';
        this.globalErrorHandlerService.handleError(Object.assign(
          new Error('Falha ao abrir a próxima etapa da verificação.'), { cause: error, silent: true }
        ));
        return EMPTY;
      }),
      finalize(() => this.setLoading(false)),
      takeUntil(this.actionChanged),
      takeUntil(this.ngUnsubscribe)
    ).subscribe();
  }

  async onSubmit(): Promise<void> {
    if (this.mode === 'resetPassword') {
      await this.resetPassword();
    }
  }

  async resetPassword(): Promise<void> {
    if (
      this.mode !== 'resetPassword' ||
      this.isLoading ||
      !this.passwordResetCodeValidated ||
      this.passwordResetCompleted ||
      this.passwordResetUnavailable
    ) {
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.confirmationTouched = true;
      this.changeDetector.markForCheck();
      return;
    }

    if (!ValidatorService.isValidPassword(this.newPassword, 8)) {
      this.message =
        'Use ao menos 8 caracteres, com letra maiúscula, minúscula e número.';
      this.changeDetector.markForCheck();
      return;
    }

    this.shouldShowRecoveryLink = false;
    this.setLoading(true);

    await firstValueFrom(
      defer(() => this.loginService.confirmPasswordReset$(this.oobCode, this.newPassword)).pipe(
        tap(() => {
          this.passwordResetOk = true;
          this.passwordResetCompleted = true;
          this.passwordResetCodeValidated = false;
          this.message = 'Senha redefinida com sucesso.';
          this.oobCode = '';
          this.newPassword = '';
          this.confirmPassword = '';
        }),
        catchError((error: unknown) => {
          this.handlePasswordResetError(error);
          return EMPTY;
        }),
        takeUntil(this.actionChanged),
        takeUntil(this.ngUnsubscribe),
        finalize(() => this.setLoading(false))
      ),
      { defaultValue: undefined }
    );
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

    this.globalErrorHandlerService.handleError(Object.assign(
      new Error('[AuthVerificationHandler] Falha técnica ao redefinir senha.'),
      { original: error, context: 'password-reset-confirmation', skipUserNotification: true }
    ));
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

  private setLoading(isLoading: boolean): void {
    this.isLoading = isLoading;
    this.changeDetector.markForCheck();
  }

  private resetActionState(): void {
    this.setLoading(true);
    this.message = '';
    this.navigationError = '';
    this.verifyOk = false;
    this.canConfirmVerification = false;
    this.canRetryVerification = false;
    this.canSwitchAccount = false;
    this.verifiedUser = null;
    this.verifiedSession = undefined;
    this.showGoToLoginCTA = false;
    this.newPassword = '';
    this.confirmPassword = '';
    this.showPassword = false;
    this.showConfirmPassword = false;
    this.confirmationTouched = false;
    this.shouldShowRecoveryLink = false;
    this.passwordResetOk = false;
    this.passwordResetCompleted = false;
    this.passwordResetUnavailable = false;
    this.passwordResetCodeValidated = false;
    this.passwordResetValidationRetryAvailable = false;
    this.passwordResetTargetEmail = '';
  }
}

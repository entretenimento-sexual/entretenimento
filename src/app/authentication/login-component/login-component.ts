// src/app/authentication/login-component/login-component.ts
// -----------------------------------------------------------------------------
// LoginComponent
// -----------------------------------------------------------------------------
// Responsabilidade desta tela:
// - autenticação por e-mail/senha;
// - autenticação por Google via AuthFacade;
// - feedback visual local do login;
// - recuperação de senha;
// - modal local para conta autenticada ainda sem e-mail verificado.
//
// O que esta tela NÃO deve fazer:
// - criar usuário diretamente;
// - escrever Firestore diretamente;
// - decidir regras profundas de onboarding;
// - hidratar manualmente CurrentUserStore.
//
// Motivo:
// O fluxo de registro/onboarding foi centralizado em RegisterFlowFacade,
// RegistrationBootstrapService, AuthSessionService e nos guards/orquestradores.
// Esta tela só dispara ações e navega conforme resultado estruturado.
// -----------------------------------------------------------------------------
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import { Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  startWith,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { AuthFacade } from 'src/app/core/services/autentication/auth/auth.facade';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';

@Component({
  selector: 'app-login-component',
  templateUrl: './login-component.html',
  styleUrls: ['./login-component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class LoginComponent implements OnInit {
  loginForm!: FormGroup;

  errorMessage = '';
  successMessage = '';
  isLoading = false;
  showEmailVerificationModal = false;

  /**
   * Habilita o botão de e-mail/senha quando os campos mínimos existem.
   * O botão Google não depende do formulário, porque é outro método de auth.
   */
  hasRequiredFields$!: Observable<boolean>;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly notify: ErrorNotificationService,
    private readonly logoutService: LogoutService,
    private readonly authFacade: AuthFacade,

    public readonly emailInputModalService: EmailInputModalService,
    public readonly emailVerificationService: EmailVerificationService,

    private readonly loginservice: LoginService,
    private readonly formBuilder: FormBuilder,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.initializeForm();

    this.hasRequiredFields$ = this.loginForm.valueChanges.pipe(
      startWith(this.loginForm.value),
      map((value) => !!(value?.email?.trim()) && !!value?.password),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  initializeForm(): void {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
      honeypot: [''],
      rememberMe: [false],
    });
  }

  get email() {
    return this.loginForm.get('email');
  }

  get password() {
    return this.loginForm.get('password');
  }

  get isHoneypotFilled(): boolean {
    return !!this.loginForm.get('honeypot')?.value;
  }

  private setBusyState(isBusy: boolean): void {
    this.isLoading = isBusy;

    /**
     * Desabilitamos o form durante qualquer login para evitar corrida:
     * - login normal;
     * - login Google;
     * - reenvio de verificação;
     * - logout do modal.
     */
    if (isBusy) {
      this.loginForm.disable({ emitEvent: false });
    } else {
      this.loginForm.enable({ emitEvent: false });
    }

    this.cdr.markForCheck();
  }

  private resetFeedback(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.markForCheck();
  }

  private setError(message: string): void {
    this.errorMessage = message;
    this.successMessage = '';
    this.notify.showError(message);
    this.cdr.markForCheck();
  }

  private setSuccess(message: string): void {
    this.successMessage = message;
    this.errorMessage = '';
    this.notify.showSuccess(message);
    this.cdr.markForCheck();
  }

  private getRedirectTo(): string {
    const raw = this.route.snapshot.queryParamMap.get('redirectTo');

    if (!raw) return '/dashboard/principal';
    if (!raw.startsWith('/')) return '/dashboard/principal';
    if (raw.startsWith('//')) return '/dashboard/principal';

    return raw;
  }

  /**
   * Login e-mail/senha.
   *
   * Observação:
   * Esta tela ainda mantém a UX local de "e-mail não verificado" porque
   * LoginService devolve esse estado imediatamente. O banner global já foi
   * ajustado para não ficar preso em estado antigo depois da verificação.
   */
  login(): void {
    if (this.isLoading) return;

    this.resetFeedback();

    const rememberMe = !!this.loginForm.get('rememberMe')?.value;

    if (this.isHoneypotFilled) {
      this.setError('Detectado comportamento suspeito. Tente novamente.');
      return;
    }

    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      this.setError('Por favor, preencha o formulário corretamente.');
      return;
    }

    const email = (this.email?.value as string).trim();
    const password = this.password?.value as string;
    const redirectTo = this.getRedirectTo();

    this.setBusyState(true);

    this.loginservice.login$(email, password, rememberMe).pipe(
      tap((result) => {
        if (!result?.success) {
          this.setError(result?.message || 'Não foi possível entrar. Tente novamente.');
          return;
        }

        if (result.emailVerified !== true) {
          this.showEmailVerificationModal = true;
          this.successMessage = '';
          this.cdr.markForCheck();
          return;
        }

        this.setSuccess('Login realizado com sucesso!');
        this.router.navigateByUrl(redirectTo, { replaceUrl: true }).catch(() => {});
      }),
      catchError((err) => {
        this.setError(err?.message || 'Erro inesperado. Tente novamente.');
        return of(void 0);
      }),
      finalize(() => this.setBusyState(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  /**
   * Login Google.
   *
   * Melhorias aplicadas:
   * - usa AuthFacade.googleLogin$(), não SocialAuthService direto;
   * - respeita SocialAuthResult.nextRoute;
   * - preserva redirectTo só quando o resultado aponta para dashboard;
   * - não depende do preenchimento do formulário;
   * - mantém feedback local e bloqueio de ações concorrentes.
   */
  loginWithGoogle(): void {
    if (this.isLoading) return;

    this.resetFeedback();
    this.showEmailVerificationModal = false;
    this.setBusyState(true);

    this.authFacade.googleLogin$().pipe(
      tap((result) => {
        if (!result?.success) {
          this.setError(result?.message || 'Não foi possível entrar com Google agora.');
          return;
        }

        const redirectTo = this.getRedirectTo();

        const target =
          result.emailVerified !== true
            ? '/register/welcome?autocheck=1'
            : result.nextRoute === '/dashboard/principal'
              ? redirectTo
              : result.nextRoute ?? redirectTo;

        this.setSuccess(result.message || 'Login com Google concluído.');
        this.router.navigateByUrl(target, { replaceUrl: true }).catch(() => {});
      }),
      catchError((err) => {
        this.setError(err?.message || 'Erro inesperado no login com Google.');
        return of(void 0);
      }),
      finalize(() => this.setBusyState(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  clearError(): void {
    if (!this.errorMessage) return;
    this.errorMessage = '';
    this.cdr.markForCheck();
  }

  openPasswordRecoveryModal(): void {
    if (this.isLoading) return;
    this.emailInputModalService.openModal();
  }

  resendVerificationEmail(): void {
    if (this.isLoading) return;

    this.setBusyState(true);

    this.emailVerificationService.resendVerificationEmail().pipe(
      tap((message) => {
        this.setSuccess(
          message ?? 'E-mail de verificação reenviado. Verifique sua caixa de entrada.'
        );
      }),
      catchError(() => {
        this.setError('Erro ao reenviar o e-mail de verificação.');
        return of(void 0);
      }),
      finalize(() => this.setBusyState(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  logout(): void {
    if (this.isLoading) return;

    this.showEmailVerificationModal = false;
    this.resetFeedback();

    this.setBusyState(true);

    this.logoutService.logout$().pipe(
      finalize(() => this.setBusyState(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.notify.showSuccess('Você saiu da sua conta.');
      },
      error: () => {
        this.setError('Não foi possível sair agora. Tente novamente.');
      },
    });
  }
}

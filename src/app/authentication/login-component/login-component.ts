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
// A decisão de onboarding pós-auth pertence ao PostAuthNavigationService,
// alimentado pelo RegisterFlowFacade. O componente não interpreta etapas.
// -----------------------------------------------------------------------------
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthFacade } from 'src/app/core/services/autentication/auth/auth.facade';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { PostAuthNavigationService } from 'src/app/register-module/data-access/post-auth-navigation.service';

type LoginAction =
  | 'idle'
  | 'emailLogin'
  | 'googleLogin'
  | 'resendVerification'
  | 'logout';

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
  currentAction: LoginAction = 'idle';
  isPasswordVisible = false;

  hasRequiredFields$!: Observable<boolean>;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly applicationError: ApplicationErrorService,
    private readonly logoutService: LogoutService,
    private readonly authFacade: AuthFacade,
    private readonly loginservice: LoginService,
    private readonly postAuthNavigation: PostAuthNavigationService,
    private readonly formBuilder: FormBuilder,
    private readonly cdr: ChangeDetectorRef,
    public readonly emailInputModalService: EmailInputModalService,
    public readonly emailVerificationService: EmailVerificationService
  ) {}

  ngOnInit(): void {
    this.initializeForm();

    this.hasRequiredFields$ = this.loginForm.valueChanges.pipe(
      startWith(this.loginForm.value),
      map((value) => !!value?.email?.trim() && !!value?.password),
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

  get passwordInputType(): 'password' | 'text' {
    return this.isPasswordVisible ? 'text' : 'password';
  }

  get passwordToggleLabel(): string {
    return this.isPasswordVisible ? 'Ocultar senha' : 'Mostrar senha';
  }

  get isEmailLoginLoading(): boolean {
    return this.currentAction === 'emailLogin';
  }

  get isGoogleLoginLoading(): boolean {
    return this.currentAction === 'googleLogin';
  }

  get isResendingVerification(): boolean {
    return this.currentAction === 'resendVerification';
  }

  get isLoggingOut(): boolean {
    return this.currentAction === 'logout';
  }

  get primaryButtonLabel(): string {
    return this.isEmailLoginLoading ? 'Conferindo acesso...' : 'Entrar';
  }

  get googleButtonLabel(): string {
    return this.isGoogleLoginLoading ? 'Abrindo Google...' : 'Continuar com Google';
  }

  get loadingMessage(): string {
    switch (this.currentAction) {
      case 'emailLogin':
        return 'Entrando e conferindo seu cadastro...';
      case 'googleLogin':
        return 'Abrindo autenticação com Google...';
      case 'resendVerification':
        return 'Reenviando e-mail de verificação...';
      case 'logout':
        return 'Encerrando sessão...';
      case 'idle':
      default:
        return 'Processando...';
    }
  }

  get currentAssistiveStatus(): string {
    // Mensagens e progresso já usam regiões aria-live dedicadas no template.
    return 'Formulário de login pronto.';
  }

  login(): void {
    if (this.isLoading) return;

    this.resetFeedback();
    this.showEmailVerificationModal = false;

    if (this.isHoneypotFilled) {
      this.setFormError('Detectado comportamento suspeito. Tente novamente.');
      return;
    }

    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      this.setFormError('Por favor, preencha o formulário corretamente.');
      return;
    }

    const email = String(this.email?.value ?? '').trim();
    const password = String(this.password?.value ?? '');
    const rememberMe = !!this.loginForm.get('rememberMe')?.value;
    const redirectTo = this.getRedirectTo();

    this.setBusyState(true, 'emailLogin');

    this.loginservice
      .login$(email, password, rememberMe)
      .pipe(
        switchMap((result) => {
          if (!result?.success) {
            this.setFormError(
              result?.message || 'Não foi possível entrar. Tente novamente.'
            );
            return of(null);
          }

          return this.postAuthNavigation.resolveAfterEmailLogin$(
            result,
            redirectTo
          );
        }),
        tap((target) => {
          if (!target) return;

          this.setSuccess('Login realizado com sucesso.');
          this.router
            .navigateByUrl(target, { replaceUrl: true })
            .catch(() => {});
        }),
        catchError((error: unknown) => {
          const descriptor = this.applicationError.report(error, {
            feature: 'login',
            operation: 'resolveAfterEmailLogin$',
            fallbackMessage: 'Não foi possível concluir o acesso agora. Tente novamente.',
            presentation: { surface: 'inline', severity: 'error' },
          });
          this.setSystemError(descriptor.userMessage);
          return of(void 0);
        }),
        finalize(() => this.setBusyState(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  loginWithGoogle(): void {
    if (this.isLoading) return;

    this.resetFeedback();
    this.showEmailVerificationModal = false;
    this.setBusyState(true, 'googleLogin');

    const redirectTo = this.getRedirectTo();

    this.authFacade
      .googleLogin$(!!this.loginForm.get('rememberMe')?.value)
      .pipe(
        switchMap((result) => {
          if (!result?.success) {
            this.setFormError(
              result?.message || 'Não foi possível entrar com Google agora.'
            );
            return of(null);
          }

          return this.postAuthNavigation
            .resolveAfterSocialLogin$(result, redirectTo)
            .pipe(
              map((target) => ({
                target,
                message: result.message || 'Login com Google concluído.',
              }))
            );
        }),
        tap((navigation) => {
          if (!navigation) return;

          this.setSuccess(navigation.message);
          this.router
            .navigateByUrl(navigation.target, { replaceUrl: true })
            .catch(() => {});
        }),
        catchError((error: unknown) => {
          const descriptor = this.applicationError.report(error, {
            feature: 'login',
            operation: 'resolveAfterSocialLogin$',
            fallbackMessage: 'Não foi possível concluir o acesso com Google agora.',
            presentation: { surface: 'inline', severity: 'error' },
          });
          this.setSystemError(descriptor.userMessage);
          return of(void 0);
        }),
        finalize(() => this.setBusyState(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  clearError(): void {
    if (!this.errorMessage) return;
    this.errorMessage = '';
    this.cdr.markForCheck();
  }

  togglePasswordVisibility(): void {
    if (this.isLoading) return;

    this.isPasswordVisible = !this.isPasswordVisible;
    this.cdr.markForCheck();
  }

  openPasswordRecoveryModal(): void {
    if (this.isLoading) return;
    this.resetFeedback();
    this.emailInputModalService.openModal();
  }

  resendVerificationEmail(): void {
    if (this.isLoading) return;

    this.setBusyState(true, 'resendVerification');

    this.emailVerificationService
      .resendVerificationEmail()
      .pipe(
        tap((message) => {
          this.setSuccess(
            message ??
              'E-mail de verificação reenviado. Verifique sua caixa de entrada.'
          );
        }),
        catchError(() => {
          this.setSystemError('Erro ao reenviar o e-mail de verificação.');
          return of(void 0);
        }),
        finalize(() => this.setBusyState(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  logout(): void {
    if (this.isLoading) return;

    this.showEmailVerificationModal = false;
    this.resetFeedback();
    this.setBusyState(true, 'logout');

    this.logoutService
      .logout$()
      .pipe(
        finalize(() => this.setBusyState(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        // LogoutService navega para login e publica a falha na autoridade
        // canônica. Mensagens locais gerariam duplicidade (snackbar + inline).
        error: () => {},
      });
  }

  private setBusyState(
    isBusy: boolean,
    action: LoginAction = 'idle'
  ): void {
    this.isLoading = isBusy;
    this.currentAction = isBusy ? action : 'idle';

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

  private setFormError(message: string): void {
    this.errorMessage = message;
    this.successMessage = '';
    this.cdr.markForCheck();
  }

  private setSystemError(message: string): void {
    this.errorMessage = message;
    this.successMessage = '';
    this.cdr.markForCheck();
  }

  private setSuccess(message: string): void {
    this.successMessage = message;
    this.errorMessage = '';
    this.cdr.markForCheck();
  }

  private getRedirectTo(): string {
    return this.sanitizeRedirectTo(
      this.route.snapshot.queryParamMap.get('redirectTo')
    );
  }

  private sanitizeRedirectTo(raw: string | null | undefined): string {
    const value = String(raw ?? '').trim();

    if (!value || !value.startsWith('/') || value.startsWith('//')) {
      return '/dashboard/principal';
    }

    if (
      value === '/login' ||
      value.startsWith('/login?') ||
      value === '/register' ||
      value.startsWith('/register?') ||
      value.startsWith('/register/welcome') ||
      value.startsWith('/register/recuperar-conta') ||
      value.startsWith('/register/aceitar-termos') ||
      value.startsWith('/register/finalizar-cadastro') ||
      value.startsWith('/adulto/confirmar')
    ) {
      return '/dashboard/principal';
    }

    return value;
  }
}

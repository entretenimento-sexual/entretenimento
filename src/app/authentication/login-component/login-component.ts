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
  filter,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
  timeout,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { AuthFacade } from 'src/app/core/services/autentication/auth/auth.facade';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { LoginResult, LoginService } from 'src/app/core/services/autentication/login.service';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { RegisterFlowFacade } from 'src/app/register-module/data-access/register-flow.facade';
import { RegisterFlowVm } from 'src/app/register-module/data-access/register-flow.model';

type LoginAction = 'idle' | 'emailLogin' | 'googleLogin' | 'resendVerification' | 'logout';

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

  /**
   * Habilita o botão de e-mail/senha quando os campos mínimos existem.
   * O botão Google não depende do formulário, porque é outro método de auth.
   */
  hasRequiredFields$!: Observable<boolean>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly POST_LOGIN_FLOW_TIMEOUT_MS = 3500;

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly notify: ErrorNotificationService,
    private readonly logoutService: LogoutService,
    private readonly authFacade: AuthFacade,

    public readonly emailInputModalService: EmailInputModalService,
    public readonly emailVerificationService: EmailVerificationService,

    private readonly loginservice: LoginService,
    private readonly registerFlow: RegisterFlowFacade,
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
    if (this.errorMessage) return this.errorMessage;
    if (this.successMessage) return this.successMessage;
    if (this.isLoading) return this.loadingMessage;
    return 'Formulário de login pronto.';
  }

  private setBusyState(isBusy: boolean, action: LoginAction = 'idle'): void {
    this.isLoading = isBusy;
    this.currentAction = isBusy ? action : 'idle';

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
    return this.sanitizeRedirectTo(this.route.snapshot.queryParamMap.get('redirectTo'));
  }

  private sanitizeRedirectTo(raw: string | null | undefined): string {
    const value = (raw ?? '').trim();

    if (!value) return '/dashboard/principal';
    if (!value.startsWith('/')) return '/dashboard/principal';
    if (value.startsWith('//')) return '/dashboard/principal';

    /**
     * Evita loop pós-login. Se o usuário já autenticou, a próxima rota deve ser
     * decidida pelo fluxo de onboarding ou pelo destino protegido original.
     */
    if (value === '/login' || value.startsWith('/login?')) return '/dashboard/principal';
    if (value === '/register' || value.startsWith('/register?')) return '/dashboard/principal';
    if (value === '/register/welcome' || value.startsWith('/register/welcome?')) return '/dashboard/principal';

    return value;
  }

  /**
   * Login e-mail/senha.
   *
   * Ajuste principal:
   * - depois do Auth, o e-mail/senha passa a respeitar o mesmo fluxo de registro
   *   usado por Welcome/Finalizar Cadastro.
   * - isso evita mandar usuário com e-mail verificado, mas perfil incompleto,
   *   diretamente para /dashboard/principal.
   */
  login(): void {
    if (this.isLoading) return;

    this.resetFeedback();
    this.showEmailVerificationModal = false;

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

    this.setBusyState(true, 'emailLogin');

    this.loginservice.login$(email, password, rememberMe).pipe(
      switchMap((result) => {
        if (!result?.success) {
          this.setError(result?.message || 'Não foi possível entrar. Tente novamente.');
          return of(null);
        }

        return this.resolvePostLoginRoute$(result, redirectTo);
      }),
      tap((target) => {
        if (!target) {
          return;
        }

        this.setSuccess('Login realizado com sucesso.');
        this.router.navigateByUrl(target, { replaceUrl: true }).catch(() => {});
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
   * Resolve a rota pós-login de e-mail/senha em harmonia com o registro.
   *
   * Ordem:
   * 1. e-mail não verificado -> welcome
   * 2. lifecycle restrito -> status da conta
   * 3. RegisterFlowFacade decide onboarding restante
   * 4. fallback defensivo pelo LoginResult
   */
  private resolvePostLoginRoute$(
    result: LoginResult,
    redirectTo: string
  ): Observable<string> {
    if (result.emailVerified !== true) {
      return of('/register/welcome?autocheck=1');
    }

    const lifecycleRoute = this.resolveAccountLifecycleRoute(result.user);
    if (lifecycleRoute) {
      return of(lifecycleRoute);
    }

    return this.registerFlow.vm$.pipe(
      filter((vm) => vm.authReady === true && !!vm.uid),
      filter((vm) => vm.userResolved === true || vm.currentStep === 'emailVerification'),
      take(1),
      timeout({
        first: this.POST_LOGIN_FLOW_TIMEOUT_MS,
        with: () => of(null as RegisterFlowVm | null),
      }),
      map((vm) => this.resolveRouteFromRegisterFlow(vm, result, redirectTo)),
      catchError(() => of(this.resolveFallbackRoute(result, redirectTo)))
    );
  }

  private resolveRouteFromRegisterFlow(
    vm: RegisterFlowVm | null,
    result: LoginResult,
    redirectTo: string
  ): string {
    if (!vm) {
      return this.resolveFallbackRoute(result, redirectTo);
    }

    const lifecycleRoute = this.resolveAccountLifecycleRoute(result.user);
    if (lifecycleRoute) {
      return lifecycleRoute;
    }

    switch (vm.currentStep) {
      case 'emailVerification':
        return '/register/welcome?autocheck=1';

      case 'profileCompletion':
        return this.profileCompletionRoute(vm.uid ?? result.user?.uid ?? null);

      case 'adultConsent':
        return vm.nextRoute || '/adulto/confirmar';

      case 'preferences':
        return redirectTo;

      case 'loading':
      case 'signup':
      default:
        return this.resolveFallbackRoute(result, redirectTo);
    }
  }

  private resolveFallbackRoute(result: LoginResult, redirectTo: string): string {
    const lifecycleRoute = this.resolveAccountLifecycleRoute(result.user);
    if (lifecycleRoute) {
      return lifecycleRoute;
    }

    if (result.emailVerified !== true) {
      return '/register/welcome?autocheck=1';
    }

    if (result.profileResolution === 'resolved' && result.needsProfileCompletion === true) {
      return this.profileCompletionRoute(result.user?.uid ?? null);
    }

    if (result.user?.profileCompleted === false) {
      return this.profileCompletionRoute(result.user?.uid ?? null);
    }

    return redirectTo;
  }

  private profileCompletionRoute(uid: string | null | undefined): string {
    const safeUid = (uid ?? '').trim();
    const redirectTo = safeUid ? `/preferencias/editar/${safeUid}` : '/dashboard/principal';

    return `/register/finalizar-cadastro?reason=profile_incomplete&redirectTo=${encodeURIComponent(redirectTo)}`;
  }

  private resolveAccountLifecycleRoute(user: IUserDados | null | undefined): string | null {
    const status = String(user?.accountStatus ?? '').trim().toLowerCase();

    if (status === 'deleted') {
      return '/conta/status?reason=deleted';
    }

    if (
      status === 'self_suspended' ||
      status === 'moderation_suspended' ||
      status === 'pending_deletion' ||
      status === 'suspended' ||
      status === 'locked' ||
      user?.suspended === true ||
      user?.accountLocked === true
    ) {
      return '/conta/status';
    }

    return null;
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
    this.setBusyState(true, 'googleLogin');

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

    this.setBusyState(true, 'logout');

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

// src/app/authentication/login-component/login-component.ts
// -----------------------------------------------------------------------------
// LoginComponent
// -----------------------------------------------------------------------------
// Responsabilidade desta tela:
// - autenticação por e-mail/senha;
// - autenticação por Google via AuthFacade;
// - feedback visual local do login;
// - recuperação de senha;
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
  Input,
  inject,
} from '@angular/core';
import { Location } from '@angular/common';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';

import { Observable, combineLatest, defer, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthFacade } from 'src/app/core/services/autentication/auth/auth.facade';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { PostAuthNavigationService } from 'src/app/register-module/data-access/post-auth-navigation.service';
import { isRegistrationStepRoute } from 'src/app/register-module/data-access/register-flow.model';

import { VOLUNTARY_LOGOUT_NOTICE } from '@core/services/autentication/auth/auth-session-exit.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { AUTH_UNAVAILABLE_REASON } from '@core/guards/_shared-guard/guard-utils';
import { isSessionEndReason, type SessionEndReason } from '@core/services/autentication/auth/auth.types';

const SESSION_END_MESSAGES: Record<SessionEndReason, string> = {
  'session-ended': 'Sua sessão foi encerrada. Entre novamente para continuar.',
  'session-expired': 'Sua sessão expirou. Entre novamente para continuar.',
  'session-disabled': 'A autenticação desta conta foi desativada. Se você precisar recuperar o acesso, fale com o suporte.',
};

type LoginAction =
  | 'idle'
  | 'emailLogin'
  | 'googleLogin';

@Component({
  selector: 'app-login-component',
  templateUrl: './login-component.html',
  styleUrls: ['./login-component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class LoginComponent implements OnInit {
  loginForm!: FormGroup;
  @Input() reason?: string;

  private readonly location = inject(Location);

  get sessionRetryHref(): string | null {
    const target = this.sessionRetryTarget;
    return target === null ? null : this.location.prepareExternalUrl(target);
  }

  get registrationRetryTarget(): string | null {
    const target = this.sessionRetryTarget;
    return target && isRegistrationStepRoute(target) ? target : null;
  }

  private get sessionRetryTarget(): string | null {
    if (this.reason !== AUTH_UNAVAILABLE_REASON) return null;
    const requested = this.route.snapshot.queryParamMap.get('redirectTo');
    const fallback = this.router.serializeUrl(this.router.createUrlTree(['/login']));
    // Mantém URL interna, inclusive a etapa de cadastro que estava aberta.
    return requested && /^\/(?![\/\\])/.test(requested) &&
      !/[\\\x00-\x1f\x7f]/.test(requested) &&
      !['/login', '/post-verification/action', '/__/auth/action'].includes(requested.split(/[?#]/)[0])
      ? requested
      : fallback;
  }

  get sessionNotice(): string | null {
    if (this.reason === VOLUNTARY_LOGOUT_NOTICE) return 'Você saiu da sua conta.';
    if (this.reason === AUTH_UNAVAILABLE_REASON) {
      return 'Não foi possível confirmar seu acesso agora. Tente novamente em instantes.';
    }
    return isSessionEndReason(this.reason) ? SESSION_END_MESSAGES[this.reason] : null;
  }

  errorMessage = '';
  isLoading = false;
  currentAction: LoginAction = 'idle';
  isRetryingRegistration = false;
  registrationRetryError = '';
  isPasswordVisible = false;

  hasRequiredFields$!: Observable<boolean>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly authSession = inject(AuthSessionService);
  readonly sessionUid$ = this.authSession.uid$;

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly applicationError: ApplicationErrorService,
    private readonly authFacade: AuthFacade,
    private readonly loginservice: LoginService,
    private readonly postAuthNavigation: PostAuthNavigationService,
    private readonly formBuilder: FormBuilder,
    private readonly cdr: ChangeDetectorRef,
    public readonly emailInputModalService: EmailInputModalService
  ) {}

  ngOnInit(): void {
    this.initializeForm();

    this.hasRequiredFields$ = this.loginForm.valueChanges.pipe(
      startWith(this.loginForm.value),
      map((value) => !!value?.email?.trim() && !!value?.password),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.resumeSharedSession();
  }

  retryRegistration(target: string): void {
    if (this.isRetryingRegistration || !this.authSession.currentAuthUser ||
        this.registrationRetryTarget !== target) return;
    this.isRetryingRegistration = true;
    this.registrationRetryError = '';
    this.navigateAfterLogin$(target).pipe(
      catchError((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'registration',
          operation: 'retryRegistration',
          fallbackMessage: 'Não foi possível consultar a próxima etapa do cadastro.',
          presentation: { surface: 'none', severity: 'warning' },
        });
        this.registrationRetryError = 'Ainda não conseguimos retomar seu cadastro. Tente novamente em instantes.';
        return of(void 0);
      }),
      finalize(() => {
        this.isRetryingRegistration = false;
        this.cdr.markForCheck();
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  private resumeSharedSession(): void {
    const loginRouteActive$ = this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map(() => this.router.url.split(/[?#]/)[0] === '/login'),
      distinctUntilChanged()
    );

    combineLatest([
      this.authSession.ready$,
      this.authSession.uid$,
      loginRouteActive$,
    ]).pipe(
      filter(([ready, uid, loginRouteActive]) =>
        ready && !!uid && loginRouteActive && !this.isLoading &&
        this.route.snapshot.queryParamMap.get('reason') !== AUTH_UNAVAILABLE_REASON),
      // Reavalia o guard da própria rota, inclusive bloqueio e perfil em cadastro.
      exhaustMap(() => defer(() => this.router.navigateByUrl(this.router.url, {
        onSameUrlNavigation: 'reload',
        replaceUrl: true,
      })).pipe(
        catchError((error: unknown) => {
          this.applicationError.report(error, {
            feature: 'login',
            operation: 'resumeSharedSession',
            fallbackMessage: 'Não foi possível continuar com a sessão atual.',
            presentation: { surface: 'none', severity: 'error' },
          });
          return of(false);
        })
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  initializeForm(): void {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
      honeypot: [''],
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
    const redirectTo = this.getRedirectTo();

    this.setBusyState(true, 'emailLogin');

    this.loginservice
      .login$(email, password)
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
        switchMap((target) => target
          ? this.navigateAfterLogin$(target)
          : of(void 0)
        ),
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
    this.setBusyState(true, 'googleLogin');

    const redirectTo = this.getRedirectTo();

    this.authFacade
      .googleLogin$()
      .pipe(
        switchMap((result) => {
          if (!result?.success) {
            this.setFormError(
              result?.message || 'Não foi possível entrar com Google agora.'
            );
            return of(null);
          }

          return this.postAuthNavigation.resolveAfterSocialLogin$(result, redirectTo);
        }),
        switchMap((target) => target
          ? this.navigateAfterLogin$(target)
          : of(void 0)
        ),
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

  private navigateAfterLogin$(target: string): Observable<void> {
    return defer(() => this.router.navigateByUrl(target, { replaceUrl: true })).pipe(
      map((navigated) => {
        if (!navigated) {
          throw Object.assign(new Error('A navegação foi interrompida.'), {
            code: 'auth/post-login-navigation',
          });
        }
      })
    );
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
    this.cdr.markForCheck();
  }

  private setFormError(message: string): void {
    this.errorMessage = message;
    this.cdr.markForCheck();
  }

  private setSystemError(message: string): void {
    this.errorMessage = message;
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

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
import type { User } from 'firebase/auth';

import { BehaviorSubject, EMPTY, Observable, Subject, combineLatest, defer, of, timer } from 'rxjs';
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
  timeout,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthFacade } from 'src/app/core/services/autentication/auth/auth.facade';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { PostAuthNavigationService } from 'src/app/register-module/data-access/post-auth-navigation.service';
import { isRegistrationStepRoute } from 'src/app/register-module/data-access/register-flow.model';
import { emailLinkSignupPreviewAllowed } from '@core/services/autentication/register/email-link-registration.service';
import { environment } from 'src/environments/environment';

import { VOLUNTARY_LOGOUT_NOTICE } from '@core/services/autentication/auth/auth-session-exit.service';
import { AuthAppBlockService } from '@core/services/autentication/auth/auth-app-block.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { AUTH_UNAVAILABLE_REASON } from '@core/guards/_shared-guard/guard-utils';
import { isSessionEndReason, type SessionEndReason } from '@core/services/autentication/auth/auth.types';

const SESSION_END_MESSAGES: Record<SessionEndReason, string> = {
  'session-ended': 'Sua sessão foi encerrada. Entre novamente para continuar.',
  'session-expired': 'Sua sessão expirou. Entre novamente para continuar.',
  'session-disabled': 'A autenticação desta conta foi desativada. Se você precisar recuperar o acesso, fale com o suporte.',
};
const SHARED_SESSION_NAVIGATION_TIMEOUT_MS = 15_000;
const SLOW_LOGIN_FEEDBACK_MS = 8_000;

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
  @Input() retomarCadastro?: string;
  protected readonly emailLinkPreview = emailLinkSignupPreviewAllowed(environment);

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
  currentAction: LoginAction = 'idle';
  sharedSessionStatus: 'opening' | 'failed' | null = null;
  isRetryingRegistration = false;
  registrationRetryError = '';
  isPasswordVisible = false;

  hasRequiredFields$!: Observable<boolean>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly authSession = inject(AuthSessionService);
  private readonly appBlock = inject(AuthAppBlockService);
  private readonly localLoginBusy$ = new BehaviorSubject(false);
  private readonly retrySharedSession$ = new Subject<void>();
  private confirmedUser: User | null = null;
  private retryConfirmedUid: string | null = null;
  private openingDestination = false;
  private waitingForCredentials = false;
  readonly sessionUid$ = this.authSession.uid$;

  get isLoading(): boolean {
    return this.localLoginBusy$.value;
  }

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

    this.localLoginBusy$.pipe(
      switchMap((busy) => busy ? timer(SLOW_LOGIN_FEEDBACK_MS).pipe(map(() => true)) : of(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((waiting) => {
      this.waitingForCredentials = waiting;
      this.cdr.markForCheck();
    });
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
      this.localLoginBusy$,
      this.appBlock.reason$,
    ]).pipe(
      map(([ready, uid, loginRouteActive, busy, blocked]) =>
        ready && loginRouteActive && !busy && blocked !== 'auth-invalid' ? uid : null),
      distinctUntilChanged(),
      switchMap((uid) => {
        this.setSharedSessionStatus(null);
        if (!uid || this.route.snapshot.queryParamMap.get('reason') === AUTH_UNAVAILABLE_REASON) {
          return EMPTY;
        }

        // Reutiliza o guard da rota original para decidir destino, bloqueio e cadastro.
        const loginUrl = this.router.url;
        const needsRetry = this.retryConfirmedUid === uid;
        this.retryConfirmedUid = null;
        if (needsRetry) this.setSharedSessionStatus('failed');
        const requests$ = needsRetry ? this.retrySharedSession$ : this.retrySharedSession$.pipe(startWith(void 0));
        return requests$.pipe(
          exhaustMap(() => this.openSharedSession$(loginUrl))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  continueWithSharedSession(): void {
    if (this.sharedSessionStatus === 'failed') this.retrySharedSession$.next();
  }

  private openSharedSession$(loginUrl: string): Observable<void> {
    return defer(() => {
      this.resetFeedback();
      this.setSharedSessionStatus('opening');
      return this.router.navigateByUrl(loginUrl, {
        onSameUrlNavigation: 'reload',
        replaceUrl: true,
      });
    }).pipe(
      timeout({ first: SHARED_SESSION_NAVIGATION_TIMEOUT_MS }),
      map((navigated) => {
        if (!navigated || this.router.url.split(/[?#]/)[0] === '/login') {
          throw new Error('A navegação com a sessão atual foi interrompida.');
        }
      }),
      catchError((error: unknown) => {
        this.setSharedSessionStatus('failed');
        try {
          this.applicationError.report(error, {
            feature: 'login',
            operation: 'resumeSharedSession',
            fallbackMessage: 'Não foi possível continuar com a sessão atual.',
            presentation: { surface: 'none', severity: 'error' },
          });
        } catch {
          // A ação de recuperação permanece disponível.
        }
        return EMPTY;
      })
    );
  }

  private setSharedSessionStatus(status: LoginComponent['sharedSessionStatus']): void {
    this.sharedSessionStatus = status;
    this.cdr.markForCheck();
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
    return this.isEmailLoginLoading ? 'Entrando…' : 'Entrar';
  }

  get googleButtonLabel(): string {
    return this.isGoogleLoginLoading ? 'Entrando…' : 'Continuar com Google';
  }

  get loadingMessage(): string {
    if (this.openingDestination) return 'Abrindo a próxima tela…';
    if (this.confirmedUser) return 'Identidade confirmada. Conferindo seu acesso…';
    switch (this.currentAction) {
      case 'emailLogin':
        return this.waitingForCredentials
          ? 'Ainda estamos aguardando a confirmação da entrada…'
          : 'Conferindo e-mail e senha…';
      case 'googleLogin':
        return this.waitingForCredentials
          ? 'Aguardando o Google. Conclua a entrada na janela aberta.'
          : 'Aguardando a confirmação do Google…';
      case 'idle':
      default:
        return 'Processando...';
    }
  }

  get currentAssistiveStatus(): string {
    return 'Formulário de login pronto.';
  }

  login(): void {
    if (this.isLoading || this.sharedSessionStatus) return;

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
    const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo');

    this.setBusyState(true, 'emailLogin');

    this.loginservice
      .login$(email, password, undefined, this.confirmIdentity)
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
          ? this.openConfirmedDestination$(target)
          : of(void 0)
        ),
        catchError((error: unknown) => {
          this.reportLoginError(error, 'resolveAfterEmailLogin$');
          return of(void 0);
        }),
        finalize(() => this.setBusyState(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  loginWithGoogle(): void {
    if (this.isLoading || this.sharedSessionStatus) return;

    this.resetFeedback();
    this.setBusyState(true, 'googleLogin');

    const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo');

    this.authFacade
      .googleLogin$(true, this.confirmIdentity)
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
          ? this.openConfirmedDestination$(target)
          : of(void 0)
        ),
        catchError((error: unknown) => {
          this.reportLoginError(error, 'resolveAfterSocialLogin$');
          return of(void 0);
        }),
        finalize(() => this.setBusyState(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private readonly confirmIdentity = (user: User): void => {
    this.confirmedUser = user;
    this.cdr.markForCheck();
  };

  private openConfirmedDestination$(target: string): Observable<void> {
    this.openingDestination = true;
    this.cdr.markForCheck();
    return this.navigateAfterLogin$(target);
  }

  private reportLoginError(error: unknown, operation: string): void {
    const user = this.confirmedUser;
    const canContinue = user && this.authSession.currentAuthUser === user &&
      !this.authSession.isTerminatingSnapshot && this.appBlock.invalidationSnapshot?.uid !== user.uid;
    if (canContinue) this.retryConfirmedUid = user.uid;
    const descriptor = this.applicationError.report(error, {
      feature: 'login',
      operation,
      fallbackMessage: 'Não foi possível concluir o acesso agora. Tente novamente.',
      presentation: { surface: canContinue ? 'none' : 'inline', severity: 'error' },
    });
    if (!canContinue) this.setSystemError(descriptor.userMessage);
  }

  private navigateAfterLogin$(target: string): Observable<void> {
    return defer(() => this.router.navigateByUrl(target, { replaceUrl: true })).pipe(
      timeout({ first: SHARED_SESSION_NAVIGATION_TIMEOUT_MS }),
      map((navigated) => {
        if (!navigated || this.router.url.split(/[?#]/)[0] === '/login') {
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
    this.currentAction = isBusy ? action : 'idle';
    this.confirmedUser = null;
    this.openingDestination = false;

    if (isBusy) {
      this.loginForm.disable({ emitEvent: false });
    } else {
      this.loginForm.enable({ emitEvent: false });
    }

    this.localLoginBusy$.next(isBusy);
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

}

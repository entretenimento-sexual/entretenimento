// src/app/authentication/login-component/login-component.ts
//Ainda não tem um Guard “anti-login quando já está logado”
// Não esquecer ferramentas de debug, comentários explicativos e manter as boas práticas.
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
  // Reactive Form
  loginForm!: FormGroup;

  // UI State
  errorMessage = '';
  successMessage = '';
  isLoading = false;
  showEmailVerificationModal = false;

  /**
   * Habilita o botão quando email/senha tiverem conteúdo,
   * mantendo UX acessível e simples de testar.
   */
  hasRequiredFields$!: Observable<boolean>;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly notify: ErrorNotificationService,
    private readonly logoutService: LogoutService,

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
      map((v) => !!(v?.email?.trim()) && !!v?.password),
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

    if (isBusy) {
      this.loginForm.disable({ emitEvent: false });
    } else {
      this.loginForm.enable({ emitEvent: false });
    }

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
   * Ajuste principal:
   * - este componente NÃO decide mais perfil incompleto.
   * - ele só trata:
   *   1) falha real
   *   2) e-mail não verificado
   *   3) sucesso de login
   *
   * A decisão de onboarding/perfil fica no fluxo canônico
   * de sessão + orchestrator + guards.
   */
  login(): void {
    if (this.isLoading) return;

    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.markForCheck();

    const rememberMe = !!this.loginForm.get('rememberMe')?.value;

    if (this.isHoneypotFilled) {
      this.setError('Detectado comportamento suspeito. Tente novamente.');
      return;
    }

    if (this.loginForm.invalid) {
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

        /**
         * Mantemos aqui apenas a UX local de e-mail não verificado.
         * Isso continua coerente com o fluxo atual.
         */
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

  clearError(): void {
    if (!this.errorMessage) return;
    this.errorMessage = '';
    this.cdr.markForCheck();
  }

  openPasswordRecoveryModal(): void {
    this.emailInputModalService.openModal();
  }

  resendVerificationEmail(): void {
    if (this.isLoading) return;

    this.setBusyState(true);

    this.emailVerificationService.resendVerificationEmail().pipe(
      tap((msg) => {
        this.setSuccess(
          msg ?? 'E-mail de verificação reenviado. Verifique sua caixa de entrada.'
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
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.markForCheck();

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
      }
    });
  }
}
//259 linhas

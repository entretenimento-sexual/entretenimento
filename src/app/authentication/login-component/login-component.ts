// src/app/authentication/login-component/login-component.ts
//Ainda não tem um Guard “anti-login quando já está logado”
import { ChangeDetectionStrategy, ChangeDetectorRef,
         Component, DestroyRef, OnInit, inject, } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import { Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, finalize, map, shareReplay, startWith, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

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
   * ✅ Habilita o botão quando email/senha tiverem conteúdo (mesmo inválidos),
   * mantendo uma UX “fácil de testar” e acessível.
   */
  hasRequiredFields$!: Observable<boolean>;

  // Angular 16+ / 19: destruição reativa (evita vazamento de subscribe)
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly router: Router,
    private readonly notify: ErrorNotificationService,

    // modais / fluxos
    public readonly emailInputModalService: EmailInputModalService,
    public readonly emailVerificationService: EmailVerificationService,

    // login
    private readonly loginservice: LoginService,

    // logout (enquanto este serviço existir no projeto)
    private readonly authService: AuthService,

    private readonly formBuilder: FormBuilder,
    private readonly cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.initializeForm();

    this.hasRequiredFields$ = this.loginForm.valueChanges.pipe(
      startWith(this.loginForm.value),
      map(v => !!(v?.email?.trim()) && !!v?.password),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  initializeForm(): void {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
      honeypot: [''], // anti-bot
      rememberMe: [false],
    });
  }

  // Getters (mantém o template limpo)
  get email() { return this.loginForm.get('email'); }
  get password() { return this.loginForm.get('password'); }
  get isHoneypotFilled(): boolean { return !!this.loginForm.get('honeypot')?.value; }

  /**
   * ✅ Mantém consistência visual + OnPush:
   * - ativa/desativa formulário
   * - exibe spinner
   */
  private setBusyState(isBusy: boolean): void {
    this.isLoading = isBusy;

    // Importante: desabilitar com emitEvent:false para não “mexer” no hasRequiredFields$
    if (isBusy) this.loginForm.disable({ emitEvent: false });
    else this.loginForm.enable({ emitEvent: false });

    this.cdr.markForCheck();
  }

  /** Centraliza escrita de erro + toast + OnPush */
  private setError(message: string): void {
    this.errorMessage = message;
    this.successMessage = '';
    this.notify.showError(message);
    this.cdr.markForCheck();
  }

  /** Centraliza escrita de sucesso + toast + OnPush */
  private setSuccess(message: string): void {
    this.successMessage = message;
    this.errorMessage = '';
    this.notify.showSuccess(message);
    this.cdr.markForCheck();
  }

  /**
   * ✅ Login reativo (sem persistência duplicada!)
   * - A persistência já é aplicada dentro do LoginService (via rememberMe).
   * - Aqui só coletamos valores, validamos e chamamos login$().
   */
  login(): void {
    if (this.isLoading) return;

    // limpa mensagens antigas antes de validar
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.markForCheck();

    const rememberMe = !!this.loginForm.get('rememberMe')?.value;

    // Honeypot: se preenchido, trava tentativa (anti-bot)
    if (this.isHoneypotFilled) {
      this.setError('Detectado comportamento suspeito. Tente novamente.');
      return;
    }

    // Validação de formulário
    if (this.loginForm.invalid) {
      this.setError('Por favor, preencha o formulário corretamente.');
      return;
    }

    const email = (this.email?.value as string).trim();
    const password = this.password?.value as string;

    this.setBusyState(true);

    this.loginservice.login$(email, password, rememberMe).pipe(
      tap((result) => {
        // O LoginService retorna success=false em falhas (não lança), então tratamos aqui.
        if (!result?.success) {
          this.setError(result?.message || 'Não foi possível entrar. Tente novamente.');
          return;
        }

        // 1) Perfil incompleto → fluxo de finalizar cadastro
        if (result.needsProfileCompletion) {
          this.router.navigate(['/finalizar-cadastro']).catch(() => { });
          return;
        }

        // 2) E-mail não verificado → abre modal
        if (!result.emailVerified) {
          this.showEmailVerificationModal = true;
          this.successMessage = '';
          this.cdr.markForCheck();
          return;
        }

        // 3) Sucesso total → segue para a área logada
        this.setSuccess('Login realizado com sucesso!');
        this.router.navigate(['/dashboard/principal']).catch(() => { });
      }),
      catchError((err) => {
        /**
         * Segurança: se acontecer um erro inesperado no componente/stream,
         * garantimos feedback. O mapeamento principal já ocorre no service
         * e no GlobalErrorHandler.
         */
        this.setError(err?.message || 'Erro inesperado. Tente novamente.');
        return of(void 0);
      }),
      finalize(() => this.setBusyState(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  /**
   * Chamado no (focus) dos inputs:
   * - limpa apenas a mensagem de erro (para não atrapalhar leitura)
   * - mantém OnPush
   */
  clearError(): void {
    if (!this.errorMessage) return;
    this.errorMessage = '';
    this.cdr.markForCheck();
  }

  openPasswordRecoveryModal(): void {
    // Modal é controlado por service (mantém nomenclatura existente)
    this.emailInputModalService.openModal();
  }

  resendVerificationEmail(): void {
    if (this.isLoading) return;

    this.setBusyState(true);

    this.emailVerificationService.resendVerificationEmail().pipe(
      tap((msg) => {
        // Mensagem padrão caso o service retorne vazio
        this.setSuccess(msg ?? 'E-mail de verificação reenviado. Verifique sua caixa de entrada.');
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

    // UX: fecha modal e limpa mensagens ao sair
    this.showEmailVerificationModal = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.markForCheck();

    this.setBusyState(true);

    this.authService.logout().pipe(
      //auth.service.ts está sendo descontinuado
      finalize(() => this.setBusyState(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        // opcional: garantir rota pública após logout
        this.router.navigate(['/login']).catch(() => { });
      },
      error: () => {
        // fallback: se logout falhar, o handler global já registrou; aqui só UX
        this.setError('Não foi possível sair agora. Tente novamente.');
      }
    });
  }
}

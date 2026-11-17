// src/app/register-module/register.component.ts
// Componente de registro por e-mail/senha.
// - Validação síncrona para apelido, e-mail, senha, confirmação e aceite dos termos.
// - Checagem reativa de disponibilidade do apelido via Observable.
// - RegisterService faz a checagem estrita antes de criar a conta.
// - Feedback visual fica na UI; detalhes técnicos só aparecem em dev autorizado.
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';

import { Auth, user } from '@angular/fire/auth';
import type { User } from 'firebase/auth';

import { defer, firstValueFrom, Observable, Subject, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  filter,
  finalize,
  map,
  switchMap,
  take,
  tap,
  startWith,
  timeout,
} from 'rxjs/operators';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RegisterService } from 'src/app/core/services/autentication/register/register.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FirestoreValidationService } from 'src/app/core/services/data-handling/firestore/validation/firestore-validation.service';
import { NicknameUtils } from 'src/app/core/utils/nickname-utils';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { IUserRegistrationData } from '../core/interfaces/iuser-registration-data';
import { environment } from 'src/environments/environment';

type UiBannerVariant = 'info' | 'warn' | 'error' | 'success';
type UiBanner = {
  variant: UiBannerVariant;
  title: string;
  message: string;
  details?: string;
  showAccessLink?: boolean;
};

type NicknameCheckState =
  | 'idle'
  | 'typing'
  | 'checking'
  | 'provisional'
  | 'taken'
  | 'unverified';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly validatorService = inject(FirestoreValidationService);
  private readonly registerService = inject(RegisterService);
  private readonly errorNotification = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  constructor(private readonly auth: Auth) {
    this.setupNicknameAvailabilityPipeline();
  }

  // ---------------- Debug opt-in ----------------
  // Disponível somente em ambiente não produtivo com enableDebugTools=true.
  // Ative com: localStorage.setItem('debugRegister', '1')
  debugEnabled(): boolean {
    return (
      !environment.production &&
      environment.enableDebugTools === true &&
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('debugRegister') === '1'
    );
  }

  private dbg(...args: unknown[]): void {
    if (this.debugEnabled()) console.debug('[Register]', ...args);
  }

  // ---------------- Form ----------------
  readonly form: FormGroup = this.fb.group(
    {
      apelidoPrincipal: this.fb.control('', {
        validators: [
          Validators.required,
          Validators.minLength(4),
          Validators.maxLength(12),
          ValidatorService.nicknameValidator(),
        ],
        updateOn: 'change',
      }),

      complementoApelido: this.fb.control('', {
        validators: [
          Validators.maxLength(12),
          ValidatorService.complementoNicknameValidator(),
        ],
        updateOn: 'change',
      }),

      email: this.fb.control('', {
        validators: [Validators.required, Validators.email],
        updateOn: 'blur',
      }),

      password: this.fb.control('', {
        validators: [
          Validators.required,
          Validators.minLength(8),
          Validators.maxLength(128),
          ValidatorService.passwordValidator(8),
        ],
        updateOn: 'change',
      }),

      confirmPassword: this.fb.control('', {
        validators: [
          Validators.required,
          Validators.maxLength(128),
        ],
        updateOn: 'change',
      }),

      // A declaração de 18+ é condição prévia à criação do UID no Auth.
      // A decisão canônica backend continua distinta desta confirmação no formulário.
      confirmarMaioridade: this.fb.control(false, {
        validators: [Validators.requiredTrue],
        updateOn: 'change',
      }),

      aceitarTermos: this.fb.control(false, {
        validators: [Validators.requiredTrue],
        updateOn: 'change',
      }),
    },
    {
      validators: [
        ValidatorService.fullNicknameValidator(),
        ValidatorService.passwordsMatchValidator(),
      ],
    }
  );

  // ---------------- UI state ----------------
  readonly isLoading = signal(false);
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);

  readonly banner = signal<UiBanner | null>(null);
  readonly showTech = signal(false);

  readonly creating = signal(false);
  readonly creatingMsg = signal('Estamos criando seu usuário, aguarde…');
  readonly syncing = signal(false);

  // ---------------- Nickname UX state ----------------
  private readonly nicknameTyping$ = new Subject<void>();
  private readonly nicknameBlur$ = new Subject<void>();

  readonly nicknameCheckState = signal<NicknameCheckState>('idle');
  readonly nicknameFeedbackArmed = signal(false);
  readonly submitted = signal(false);

  private readonly apelidoPrincipalSig = toSignal(
    this.form.get('apelidoPrincipal')!.valueChanges.pipe(
      startWith(this.form.get('apelidoPrincipal')!.value)
    ),
    { initialValue: this.form.get('apelidoPrincipal')!.value }
  );

  private readonly complementoSig = toSignal(
    this.form.get('complementoApelido')!.valueChanges.pipe(
      startWith(this.form.get('complementoApelido')!.value)
    ),
    { initialValue: this.form.get('complementoApelido')!.value }
  );

  private readonly apelidoStatusSig = toSignal(
    this.form.get('apelidoPrincipal')!.statusChanges.pipe(
      startWith(this.form.get('apelidoPrincipal')!.status)
    ),
    { initialValue: this.form.get('apelidoPrincipal')!.status }
  );

  readonly apelidoCompleto = computed(() => {
    const p = String(this.apelidoPrincipalSig() ?? '');
    const c = String(this.complementoSig() ?? '');
    return NicknameUtils.montarApelidoCompleto(p, c);
  });

  readonly apelidoEmUso = computed(() => {
    this.apelidoStatusSig();
    return this.form.get('apelidoPrincipal')?.hasError('apelidoEmUso') === true;
  });

  readonly nicknameChecking = computed(
    () => this.nicknameCheckState() === 'checking'
  );

  private hasBlockingNicknameSyncErrors(): boolean {
    const ctrl = this.form.get('apelidoPrincipal');
    if (!ctrl) return true;

    const e = ctrl.errors ?? {};
    return !!(
      e['required'] ||
      e['minlength'] ||
      e['maxlength'] ||
      e['invalidNickname']
    );
  }

  private hasBlockingComplementSyncErrors(): boolean {
    const ctrl = this.form.get('complementoApelido');
    if (!ctrl) return false;

    const e = ctrl.errors ?? {};
    return !!(e['maxlength'] || e['invalidNickname']);
  }

  private clearApelidoEmUsoError(): void {
    const ctrl = this.form.get('apelidoPrincipal');
    if (!ctrl) return;

    const currentErrors = ctrl.errors;
    if (!currentErrors || !currentErrors['apelidoEmUso']) return;

    const { apelidoEmUso, ...rest } = currentErrors;
    ctrl.setErrors(Object.keys(rest).length ? rest : null);
  }

  private setApelidoEmUsoError(): void {
    const ctrl = this.form.get('apelidoPrincipal');
    if (!ctrl) return;
    ctrl.setErrors({ ...(ctrl.errors || {}), apelidoEmUso: true });
  }

  onNicknameTyping(): void {
    this.nicknameFeedbackArmed.set(false);
    this.clearApelidoEmUsoError();
    this.nicknameCheckState.set('typing');
    this.nicknameTyping$.next();
  }

  onNicknameBlur(): void {
    this.nicknameFeedbackArmed.set(true);
    this.nicknameBlur$.next();
  }

  onComplementoBlur(): void {
    this.nicknameFeedbackArmed.set(true);
    this.nicknameBlur$.next();
  }

  private setupNicknameAvailabilityPipeline(): void {
    this.nicknameTyping$
      .pipe(
        debounceTime(3000),
        tap(() => {
          this.nicknameFeedbackArmed.set(true);
          this.dbg('nickname idle -> check');
        }),
        switchMap(() => this.runNicknameAvailabilityCheck$()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.nicknameBlur$
      .pipe(
        tap(() => this.dbg('nickname blur -> check')),
        switchMap(() => this.runNicknameAvailabilityCheck$()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private runNicknameAvailabilityCheck$(): Observable<void> {
    if (
      this.hasBlockingNicknameSyncErrors() ||
      this.hasBlockingComplementSyncErrors()
    ) {
      this.nicknameCheckState.set('idle');
      this.clearApelidoEmUsoError();
      return of(void 0);
    }

    if (this.form.hasError('invalidFullNickname')) {
      this.nicknameCheckState.set('idle');
      this.clearApelidoEmUsoError();
      return of(void 0);
    }

    const fullNick = (this.apelidoCompleto() || '').trim();
    if (!fullNick) {
      this.nicknameCheckState.set('idle');
      this.clearApelidoEmUsoError();
      return of(void 0);
    }

    this.nicknameCheckState.set('checking');

    return this.validatorService
      .checkIfNicknameExists(fullNick, { mode: 'soft' })
      .pipe(
        tap((exists: boolean) => {
          if (exists) {
            this.setApelidoEmUsoError();
            this.nicknameCheckState.set('taken');
          } else {
            this.clearApelidoEmUsoError();
            this.nicknameCheckState.set('provisional');
          }
        }),
        map(() => void 0),
        catchError((err) => {
          this.dbg('nickname check error', err);
          this.nicknameCheckState.set('unverified');
          this.clearApelidoEmUsoError();

          return of(void 0);
        })
      );
  }

  private waitForAuthUserOnce(
    timeoutMs = 6000,
    expectedUid?: string
  ): Observable<User> {
    return defer(() => {
      const existing = this.auth.currentUser;
      return existing ? of(existing) : user(this.auth).pipe(
        filter((value): value is User => !!value),
        take(1),
        timeout({ first: timeoutMs })
      );
    }).pipe(
      map((activeUser) => {
        if (expectedUid && activeUser.uid !== expectedUid) {
          throw new Error('A conta ativa mudou durante o cadastro.');
        }
        return activeUser;
      })
    );
  }

  private setBanner(
    variant: UiBannerVariant,
    title: string,
    message: string,
    details?: unknown,
    showAccessLink = false
  ): void {
    let det: string | undefined;

    /**
     * Detalhes técnicos nunca são serializados no estado da UI em produção.
     * O erro completo continua sendo tratado pelos serviços centralizados.
     */
    if (details !== undefined && this.debugEnabled()) {
      try {
        det = typeof details === 'string'
          ? details
          : JSON.stringify(details, null, 2);
      } catch {
        det = String(details);
      }
    }

    this.banner.set({ variant, title, message, details: det, ...(showAccessLink ? { showAccessLink } : {}) });
    this.showTech.set(false);
  }

  toggleTech(): void {
    if (!this.debugEnabled()) return;
    this.showTech.update((v) => !v);
  }

  async syncSessionNow(): Promise<void> {
    if (!this.debugEnabled() || this.syncing()) return;
    this.syncing.set(true);

    try {
      await firstValueFrom(this.waitForAuthUserOnce());
      this.router.navigate(['/register/welcome'], {
        queryParams: { autocheck: '1' },
        replaceUrl: true,
      });
    } catch (e) {
      this.setBanner(
        'warn',
        'Não conseguimos confirmar sua sessão ainda',
        'A sessão não ficou visível a tempo. Tente novamente ou recarregue a página.',
        e
      );
    } finally {
      this.syncing.set(false);
    }
  }

  copyDetails(): void {
    if (!this.debugEnabled()) return;

    const det = this.banner()?.details;
    if (
      !det ||
      typeof navigator === 'undefined' ||
      !navigator.clipboard
    ) {
      return;
    }

    navigator.clipboard.writeText(det).catch(() => { });
  }

  reloadPage(): void {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((v) => !v);
  }

  getError(controlName: string): string | null {
    const ctrl = this.form.get(controlName);
    if (!ctrl) return null;

    const errs = ctrl.errors || {};

    if (
      controlName === 'apelidoPrincipal' &&
      this.form.hasError('invalidFullNickname')
    ) {
      return 'Apelido completo inválido.';
    }

    if (errs['required']) {
      if (controlName === 'confirmarMaioridade') {
        return 'É necessário declarar que você tem 18 anos ou mais para criar uma conta.';
      }
      if (controlName === 'aceitarTermos') {
        return 'É necessário aceitar os Termos de Uso vigentes para criar uma conta.';
      }
      return 'Campo obrigatório';
    }

    if (controlName === 'email' && errs['email']) {
      return 'Formato de e-mail inválido';
    }

    if (controlName === 'password' && errs['minlength']) {
      return `Senha precisa ter ao menos ${errs['minlength'].requiredLength} caracteres.`;
    }

    if (controlName === 'password' && errs['invalidPassword']) {
      return 'Use ao menos uma letra maiúscula, uma minúscula e um número.';
    }

    if (
      controlName === 'confirmPassword' &&
      this.form.hasError('passwordMismatch')
    ) {
      return 'As senhas não coincidem.';
    }

    if (errs['minlength']) {
      return `Mínimo de ${errs['minlength'].requiredLength} caracteres.`;
    }
    if (errs['maxlength']) {
      return `Máximo de ${errs['maxlength'].requiredLength} caracteres.`;
    }
    if (errs['invalidNickname']) return 'Contém caracteres inválidos.';
    if (errs['apelidoEmUso']) return 'Este apelido já está em uso.';

    return null;
  }

  onSubmit(): void {
    if (this.isLoading()) return;

    this.submitted.set(true);
    this.nicknameFeedbackArmed.set(true);

    this.form.markAllAsTouched();
    this.form.updateValueAndValidity();

    if (this.nicknameChecking()) {
      this.errorNotification.showInfo(
        'Aguarde a validação do apelido terminar.'
      );
      return;
    }

    if (this.form.invalid) {
      this.setBanner(
        'error',
        'Verifique os campos',
        'Há campos obrigatórios ou inválidos. Corrija e tente novamente.'
      );
      return;
    }

    this.isLoading.set(true);
    this.creating.set(true);
    this.creatingMsg.set('Estamos criando seu usuário, aguarde…');
    this.banner.set(null);

    const { email, password, aceitarTermos, confirmarMaioridade } = this.form.getRawValue() as any;
    const now = Date.now();

    const payload: IUserRegistrationData = {
      email,
      nickname: (this.apelidoCompleto() || '').trim(),
      // Declaração pré-Auth: NUNCA substitui age_eligibility_records/{uid}.
      confirmsAdult: confirmarMaioridade === true,
      acceptedTerms: { accepted: aceitarTermos, date: now },
      emailVerified: false,
      isSubscriber: false,
      firstLogin: now,
      registrationDate: now,
      profileCompleted: false,
    };

    this.registerService.registerUser(payload, password)
      .pipe(
        switchMap((result) => this.waitForAuthUserOnce(8000, result.user.uid).pipe(
          switchMap(() => {
            if (this.auth.currentUser?.uid !== result.user.uid) {
              throw new Error('A conta ativa mudou durante o cadastro.');
            }

            this.creatingMsg.set('Conta criada. Abrindo a verificação de e-mail…');
            return this.router.navigate(['/register/welcome'], {
              queryParams: {
                autocheck: '1',
                verificationEmail: result.verificationEmailSent ? 'sent' : 'failed',
              },
              replaceUrl: true,
            });
          }),
          map((navigated) => {
            if (!navigated) throw new Error('A tela de verificação não abriu.');
          }),
          catchError((error: unknown) => {
            const report = this.applicationError.report(error, {
              feature: 'registration',
              operation: 'openVerificationAfterSignup',
              fallbackMessage:
                'Não conseguimos abrir a próxima etapa. Entre com o e-mail usado no cadastro para continuar.',
              presentation: { surface: 'inline', severity: 'warning' },
            });
            this.setBanner('warn', 'Sua conta foi criada', report.userMessage, error, true);
            return of(void 0);
          })
        )),
        finalize(() => {
          this.isLoading.set(false);
          this.creating.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        error: (err: any) => {
          this.creating.set(false);

          const code = err?.code || '';
          const rawMsg = String(err?.message || '').toLowerCase();

          if (
            code === 'auth/unauthorized-domain' ||
            code === 'auth/invalid-continue-uri'
          ) {
            this.setBanner(
              'error',
              'Falha ao enviar e-mail de verificação',
              'Não foi possível preparar o redirecionamento. Procure o suporte.',
              err
            );
            return;
          }

          if (code === 'registration-account-created') {
            this.setBanner('warn', 'Sua conta foi criada',
              'Entre com o e-mail usado no cadastro para continuar.', err, true);
            return;
          }

          if (code === 'registration-creation-unconfirmed' || code === 'email-exists-soft' ||
              code === 'registration-session-active') {
            this.setBanner('info', 'Confira seu acesso',
              'Tente entrar com os dados informados ou recuperar o acesso para continuar.', undefined, true);
            return;
          }

          if (code === 'nickname-check-failed') {
            this.setBanner(
              'warn',
              'Não foi possível validar o apelido',
              'Tente novamente em instantes antes de concluir o cadastro.',
              err
            );
            return;
          }

          if (code === 'auth/too-many-requests') {
            this.setBanner(
              'warn',
              'Muitas tentativas',
              'Aguarde alguns minutos e tente novamente.',
              err
            );
            return;
          }

          if (
            code === 'nickname-in-use' ||
            /apelido.*em uso/.test(rawMsg)
          ) {
            this.setApelidoEmUsoError();
            this.nicknameCheckState.set('taken');
            setTimeout(() =>
              document.getElementById('apelidoPrincipal')?.focus()
            );
            return;
          }

          this.setBanner(
            'error',
            'Não foi possível concluir o cadastro',
            'Tente novamente. Se o problema continuar, procure o suporte.',
            err
          );
        },
      });
  }
}

/*
Fluxo de registro:
1. Usuário preenche apelido principal, complemento, e-mail, senha, confirmação e aceita termos.
2. Enquanto digita o apelido, após 3s de inatividade ou no blur, checa disponibilidade em modo soft.
3. No submit, valida complexidade e igualdade das senhas e faz checagem estrita do apelido.
4. Apenas a senha principal segue para o Firebase Auth; a confirmação permanece somente no formulário.
5. Se tudo estiver válido, cria a conta, registra o aceite auditável, preserva o resultado do envio de verificação e espera a sessão aparecer.
6. Se a auditoria de termos falhar temporariamente, o fluxo canônico solicitará o aceite novamente depois.
*/
// src/app/register-module/register.component.ts
// Não esqueça os comentários explicativos e ferramentas de debug.
//
// Componente de registro de usuário.
// - Validação síncrona (regex/required/tamanho) para nickname.
// - Validação de "apelido completo" (principal + complemento).
// - Checagem de disponibilidade do apelido (Firestore) via Observable:
//   -> após 3s de inatividade e/ou no blur.
// - Submit faz "strict check" antes de criar a conta (não confia em checagem soft).
// - Feedback de erro via ErrorNotificationService; erros inesperados sobem para GlobalErrorHandler quando não capturados.
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl, // AbstractControl está esmaecido
  FormBuilder,
  FormGroup,
  ValidationErrors, // ValidationErrors também está esmaecido
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';

import { Auth, user } from '@angular/fire/auth';
import type { User } from 'firebase/auth';

import { firstValueFrom, Observable, Subject, of, throwError } from 'rxjs';
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
  distinctUntilChanged, // distinctUntilChanged pode ser útil para evitar checagens repetidas do mesmo apelido
} from 'rxjs/operators';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RegisterService } from 'src/app/core/services/autentication/register/register.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FirestoreValidationService } from 'src/app/core/services/data-handling/firestore/validation/firestore-validation.service';
import { NicknameUtils } from 'src/app/core/utils/nickname-utils';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { IUserRegistrationData } from '../core/interfaces/iuser-registration-data';

type UiBannerVariant = 'info' | 'warn' | 'error' | 'success';
type UiBanner = {
  variant: UiBannerVariant;
  title: string;
  message: string;
  details?: string;
};

type NicknameCheckState = 'idle' | 'typing' | 'checking' | 'available' | 'taken' | 'unverified';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private validatorService = inject(FirestoreValidationService);
  private registerService = inject(RegisterService);
  private errorNotification = inject(ErrorNotificationService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  // AngularFire Auth
  constructor(private auth: Auth) {
    this.setupNicknameAvailabilityPipeline();
  }

  // ---------------- Debug (opt-in via localStorage) ----------------
  // Ative com: localStorage.setItem('debugRegister', '1')
  private debugEnabled(): boolean {
    return localStorage.getItem('debugRegister') === '1';
  }
  private dbg(...args: any[]): void {
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
        updateOn: 'change', // precisamos do valor em tempo real para preview
      }),

      complementoApelido: this.fb.control('', {
        validators: [
          Validators.maxLength(12),
          ValidatorService.complementoNicknameValidator(),
        ],
        updateOn: 'change', // idem: muda o apelido completo em tempo real
      }),

      email: this.fb.control('', {
        validators: [Validators.required, Validators.email],
        updateOn: 'blur', // evita validação agressiva enquanto digita
      }),

      password: this.fb.control('', {
        validators: [Validators.required, Validators.minLength(6)],
        updateOn: 'blur',
      }),

      aceitarTermos: this.fb.control(false, {
        validators: [Validators.requiredTrue],
        updateOn: 'change',
      }),
    },
    {
      // Validação do apelido completo (principal + complemento)
      // Ideal: alinhar o "full" ao mesmo formato do NicknameUtils.
      validators: [ValidatorService.fullNicknameValidator()],
    }
  );

  // ---------------- UI state ----------------
  readonly isLoading = signal(false);
  readonly showPassword = signal(false);
  readonly infoMessage = signal<string | null>(null);

  readonly banner = signal<UiBanner | null>(null);
  readonly showTech = signal(false);

  readonly creating = signal(false);
  readonly creatingMsg = signal('Estamos criando seu usuário, aguarde…');
  readonly syncing = signal(false);

  // ---------------- Nickname UX state ----------------
  private nicknameTyping$ = new Subject<void>();
  private nicknameBlur$ = new Subject<void>();

  readonly nicknameCheckState = signal<NicknameCheckState>('idle');

  // “Arma” a exibição de feedback mesmo sem blur (inatividade de 3s) e no blur.
  readonly nicknameFeedbackArmed = signal(false);
  readonly submitted = signal(false);

  // Bridges (FormControl -> Signal) para computed reativo
  private apelidoPrincipalSig = toSignal(
    this.form.get('apelidoPrincipal')!.valueChanges.pipe(
      startWith(this.form.get('apelidoPrincipal')!.value)
    ),
    { initialValue: this.form.get('apelidoPrincipal')!.value }
  );

  private complementoSig = toSignal(
    this.form.get('complementoApelido')!.valueChanges.pipe(
      startWith(this.form.get('complementoApelido')!.value)
    ),
    { initialValue: this.form.get('complementoApelido')!.value }
  );

  private apelidoStatusSig = toSignal(
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
    // força recompute quando status/errors mudam
    this.apelidoStatusSig();
    return this.form.get('apelidoPrincipal')?.hasError('apelidoEmUso') === true;
  });

  readonly nicknameChecking = computed(() => this.nicknameCheckState() === 'checking');

  // ---------------- Nickname helpers ----------------
  private hasBlockingNicknameSyncErrors(): boolean {
    const ctrl = this.form.get('apelidoPrincipal');
    if (!ctrl) return true;

    const e = ctrl.errors ?? {};
    // Não bloqueia por "apelidoEmUso" (isso é resultado da checagem, não pré-condição)
    return !!(e['required'] || e['minlength'] || e['maxlength'] || e['invalidNickname']);
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
    // Nova ação do usuário: esconde feedback e limpa "em uso" até re-checar
    this.nicknameFeedbackArmed.set(false);
    this.clearApelidoEmUsoError();

    this.nicknameCheckState.set('typing');
    this.nicknameTyping$.next();
  }

  // Opcional, mas recomendado (use no blur do input principal)
  onNicknameBlur(): void {
    this.nicknameFeedbackArmed.set(true);
    this.nicknameBlur$.next();
  }

  onComplementoBlur(): void {
    // Complemento afeta o apelido completo, então dispara checagem imediatamente
    this.nicknameFeedbackArmed.set(true);
    this.nicknameBlur$.next();
  }

  private setupNicknameAvailabilityPipeline(): void {
    // Após 3s sem digitar: arma feedback e checa disponibilidade (modo soft)
    this.nicknameTyping$
      .pipe(
        debounceTime(3000),
        tap(() => {
          this.nicknameFeedbackArmed.set(true);
          this.dbg('nickname idle -> check');
        }),
        switchMap(() => this.runNicknameAvailabilityCheck$('soft')),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    // No blur (principal ou complemento): checa imediatamente (modo soft)
    this.nicknameBlur$
      .pipe(
        tap(() => this.dbg('nickname blur -> check')),
        switchMap(() => this.runNicknameAvailabilityCheck$('soft')),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private runNicknameAvailabilityCheck$(mode: 'soft' | 'strict'): Observable<void> {
    // Se ainda nem dá para validar (sync), não chama rede
    if (this.hasBlockingNicknameSyncErrors() || this.hasBlockingComplementSyncErrors()) {
      this.nicknameCheckState.set('idle');
      this.clearApelidoEmUsoError();
      return of(void 0);
    }

    // Se o formGroup acusa apelido completo inválido, também não chama rede
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

    return this.validatorService.checkIfNicknameExists(fullNick, { mode }).pipe(
      tap((exists: boolean) => {
        if (exists) {
          this.setApelidoEmUsoError();
          this.nicknameCheckState.set('taken');
        } else {
          this.clearApelidoEmUsoError();
          this.nicknameCheckState.set('available');
        }
      }),
      map(() => void 0),
      catchError((err) => {
        // Soft: não “quebra” UX por falha de rede/permissão — apenas marca como não verificado
        this.dbg('nickname check error', err);
        this.nicknameCheckState.set('unverified');
        this.clearApelidoEmUsoError();
        return of(void 0);
      }),
      finalize(() => {
        // Mantém estado available/taken/unverified para UI; não volta para idle automaticamente
      })
    );
  }

  // ---------------- Auth wait ----------------
  private waitForAuthUserOnce(timeoutMs = 6000): Promise<User> {
    const existing = this.auth.currentUser as User | null;
    if (existing) return Promise.resolve(existing);

    const wait$ = user(this.auth).pipe(
      filter((u): u is User => !!u),
      take(1)
    );

    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('auth-wait-timeout')), timeoutMs)
    );

    return Promise.race([firstValueFrom(wait$), timeout]);
  }

  // ---------------- Errors/UI helpers ----------------
  private setBanner(variant: UiBannerVariant, title: string, message: string, details?: any) {
    let det: string | undefined;
    if (details !== undefined) {
      try {
        det = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
      } catch {
        det = String(details);
      }
    }
    this.banner.set({ variant, title, message, details: det });
    this.showTech.set(false);
  }

  toggleTech(): void {
    this.showTech.update((v) => !v);
  }

  async syncSessionNow(): Promise<void> {
    if (this.syncing()) return;
    this.syncing.set(true);

    try {
      await this.waitForAuthUserOnce(6000);
      const email = this.form.get('email')?.value || '';
      this.router.navigate(['/register/welcome'], {
        queryParams: { email, autocheck: '1' },
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
    const det = this.banner()?.details;
    if (!det || !navigator?.clipboard) return;
    navigator.clipboard.writeText(det).catch(() => { });
  }

  resetForm(): void {
    this.form.reset({
      apelidoPrincipal: '',
      complementoApelido: '',
      email: '',
      password: '',
      aceitarTermos: false,
    });
    this.banner.set(null);
    this.infoMessage.set(null);
    this.nicknameCheckState.set('idle');
    this.nicknameFeedbackArmed.set(false);
    this.submitted.set(false);
  }

  reloadPage(): void {
    window.location.reload();
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  getError(controlName: string): string | null {
    const ctrl = this.form.get(controlName);

    // Observação: para nickname, você controla "quando mostrar" pelo template
    // via submitted()/nicknameFeedbackArmed(). Aqui só traduz erros -> mensagens.

    if (!ctrl) return null;

    const errs = ctrl.errors || {};

    // Apelido completo inválido (erro no FormGroup) — tratamos como feedback do apelido principal
    if (controlName === 'apelidoPrincipal' && this.form.hasError('invalidFullNickname')) {
      return 'Apelido completo inválido.';
    }

    if (errs['required']) return 'Campo obrigatório';
    if (errs['minlength']) return `Mínimo de ${errs['minlength'].requiredLength} caracteres.`;
    if (errs['maxlength']) return `Máximo de ${errs['maxlength'].requiredLength} caracteres.`;
    if (errs['invalidNickname']) return 'Contém caracteres inválidos.';
    if (errs['apelidoEmUso']) return 'Este apelido já está em uso.';

    if (controlName === 'email' && errs['email']) return 'Formato de e-mail inválido';
    if (controlName === 'password' && errs['minlength']) {
      return `Senha precisa ter ao menos ${errs['minlength'].requiredLength} caracteres.`;
    }

    return null;
  }

  // ---------------- Submit ----------------
  onSubmit(): void {
    if (this.isLoading()) return;

    this.submitted.set(true);
    this.nicknameFeedbackArmed.set(true);

    this.form.markAllAsTouched();
    this.form.updateValueAndValidity();

    // Se estiver checando nickname, bloqueia o submit (mesma UX “plataformas grandes”)
    if (this.nicknameChecking()) {
      this.errorNotification.showError('Aguarde a validação do apelido terminar.');
      return;
    }

    if (this.form.invalid) {
      this.setBanner(
        'error',
        'Verifique os campos',
        'Há campos obrigatórios ou inválidos. Corrija e tente novamente.'
      );
      this.errorNotification.showError('Verifique os campos preenchidos.');
      return;
    }

    this.isLoading.set(true);
    this.creating.set(true);
    this.creatingMsg.set('Estamos criando seu usuário, aguarde…');
    this.infoMessage.set(null);
    this.banner.set(null);

    const { email, password, aceitarTermos } = this.form.getRawValue() as any;
    const now = Date.now();

    const payload: IUserRegistrationData = {
      email,
      nickname: (this.apelidoCompleto() || '').trim(),
      acceptedTerms: { accepted: aceitarTermos, date: now },
      emailVerified: false,
      isSubscriber: false,
      firstLogin: now,
      registrationDate: now,
      profileCompleted: false,
    };

    const fullNick = (payload.nickname || '').trim();

    // Submit: strict check (não assume disponibilidade se falhar rede/regras)
    this.runNicknameAvailabilityCheck$('strict')
      .pipe(
        switchMap(() => {
          // se strict check marcou "em uso", interrompe
          if (this.apelidoEmUso()) {
            return throwError(() => ({ code: 'nickname-in-use', message: 'Apelido em uso.' }));
          }
          return this.registerService.registerUser(payload, password);
        }),
        finalize(() => this.isLoading.set(false))
      )
      .subscribe({
        next: async () => {
          try {
            await this.waitForAuthUserOnce(8000);
          } catch (e) {
            this.creating.set(false);
            this.setBanner(
              'warn',
              'Conta criada, mas a sessão ainda não apareceu',
              'Você pode sincronizar a sessão agora ou recarregar a página.',
              e
            );
            return;
          }

          this.creatingMsg.set('Tudo pronto! Redirecionando…');
          this.router
            .navigate(['/register/welcome'], { queryParams: { email, autocheck: '1' }, replaceUrl: true })
            .finally(() => this.creating.set(false));
        },

        error: (err: any) => {
          this.creating.set(false);

          const code = err?.code || '';
          const rawMsg = String(err?.message || '').toLowerCase();

          if (code === 'auth/unauthorized-domain' || code === 'auth/invalid-continue-uri') {
            this.setBanner(
              'error',
              'Falha ao enviar e-mail de verificação',
              'Domínio de redirecionamento não autorizado. Avise o suporte.',
              err
            );
            this.errorNotification.showError('Não foi possível enviar o e-mail de verificação (domínio não autorizado).');
            return;
          }

          // Política de privacidade: não confirmar “e-mail em uso” de forma explícita
          if (code === 'email-exists-soft') {
            const msg = 'Se existir uma conta com este e-mail, você receberá instruções para recuperar o acesso.';
            this.infoMessage.set(msg);
            this.setBanner('info', 'E-mail possivelmente já cadastrado', msg, err);
            return;
          }

          if (code === 'auth/too-many-requests') {
            this.setBanner('warn', 'Muitas tentativas', 'Aguarde alguns minutos e tente novamente.', err);
            return;
          }

          if (code === 'nickname-in-use' || /apelido.*em uso/.test(rawMsg)) {
            this.setApelidoEmUsoError();
            this.nicknameCheckState.set('taken');
            this.setBanner('error', 'Apelido em uso', 'Escolha outro apelido para continuar.', err);
            this.errorNotification.showError('Apelido em uso. Escolha outro.');
            setTimeout(() => document.getElementById('apelidoPrincipal')?.focus());
            return;
          }

          this.setBanner(
            'error',
            'Não foi possível concluir o cadastro',
            'Tente novamente. Se persistir, copie os detalhes técnicos e envie ao suporte.',
            err
          );
          this.errorNotification.showError('Não foi possível concluir o cadastro. Tente novamente.');
        },
      });
  }
} // linha 567 - fim do componente

/*
Fluxo de registro:
1. Usuário preenche apelido principal, complemento, email, senha e aceita termos.
2. Enquanto digita o apelido, após 3s de inatividade ou no blur, checa disponibilidade (modo soft).
3. No submit, faz validação completa e checagem estrita de disponibilidade do apelido.
4. Se tudo ok, cria conta e espera sessão aparecer.
5. Se sessão não aparecer em X segundos, mostra banner com opção de sincronizar sessão manualmente.
*/

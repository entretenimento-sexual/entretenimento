// src/app/register-module/register.component.ts
import { ChangeDetectionStrategy, Component, computed, effect,
        inject, signal, DestroyRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors
        } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom, Observable, of, throwError, Subject } from 'rxjs';
import { catchError, finalize, map, take, filter, startWith, debounceTime,
         tap, switchMap } from 'rxjs/operators';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RegisterService } from 'src/app/core/services/autentication/register/register.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FirestoreValidationService } from 'src/app/core/services/data-handling/firestore/validation/firestore-validation.service';
import { NicknameUtils } from 'src/app/core/utils/nickname-utils';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { IUserRegistrationData } from '../core/interfaces/iuser-registration-data';

// ✅ AngularFire
import { Auth, user } from '@angular/fire/auth';
import type { User } from 'firebase/auth';

type UiBannerVariant = 'info' | 'warn' | 'error' | 'success';
type UiBanner = {
  variant: UiBannerVariant;
  title: string;
  message: string;
  details?: string;
};

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private validatorService = inject(FirestoreValidationService);
  private registerService = inject(RegisterService);
  private errorNotification = inject(ErrorNotificationService);
  private router = inject(Router);

  private destroyRef = inject(DestroyRef);

  // ✅ injeta Auth de @angular/fire/auth
  constructor(private auth: Auth) {
    // ✅ “some o erro enquanto digita” (padrão plataformas grandes)
    this.nicknameTyping$
      .pipe(
        tap(() => this.isNicknameTyping.set(true)),
        debounceTime(3000),
        tap(() => {
          this.isNicknameTyping.set(false);
          // revalida após inércia (mantendo updateOn blur, mas dando “ajuda” na UX)
          this.form.get('apelidoPrincipal')?.updateValueAndValidity({ onlySelf: true });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ---------------- form ----------------
  readonly form: FormGroup = this.fb.group({
    apelidoPrincipal: this.fb.control('', {
      validators: [
        Validators.required,
        Validators.minLength(4),
        Validators.maxLength(12),
        ValidatorService.nicknameValidator()
      ],
      asyncValidators: [this.apelidoAsyncValidator.bind(this)],
      updateOn: 'blur'
    }),
    complementoApelido: this.fb.control('', { updateOn: 'blur' }),
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    aceitarTermos: [false, Validators.requiredTrue]
  });

  // ---------------- state ----------------
  readonly isLoading = signal(false);
  readonly showPassword = signal(false);
  readonly infoMessage = signal<string | null>(null);

  readonly banner = signal<UiBanner | null>(null);
  readonly showTech = signal(false);

  readonly creating = signal(false);
  readonly creatingMsg = signal('Estamos criando seu usuário, aguarde…');
  readonly syncing = signal(false);

  // ✅ controle de “usuário está digitando”
  private nicknameTyping$ = new Subject<void>();
  readonly isNicknameTyping = signal(false);

  // ✅ Bridge: FormControl -> Signal (para computed/effect serem de fato reativos)
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
    this.apelidoStatusSig(); // força recalcular quando erros/status mudarem
    return this.form.get('apelidoPrincipal')?.hasError('apelidoEmUso') === true;
  });

  // ✅ espera o user com AngularFire (zone-safe)
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

  // ---------------- helpers de erro de apelido ----------------
  private clearApelidoEmUsoError(): void {
    const ctrl = this.form.get('apelidoPrincipal');
    if (!ctrl) return;

    const currentErrors = ctrl.errors;
    if (!currentErrors || !currentErrors['apelidoEmUso']) return;

    const { apelidoEmUso, ...rest } = currentErrors;
    const hasOtherErrors = Object.keys(rest).length > 0;
    ctrl.setErrors(hasOtherErrors ? rest : null);
  }

  onNicknameTyping(): void {
    this.clearApelidoEmUsoError();
    this.nicknameTyping$.next();
  }

  // ✅ quando o complemento muda, o apelido completo muda — então revalida
  onComplementoBlur(): void {
    this.form.get('apelidoPrincipal')?.updateValueAndValidity({ onlySelf: true });
  }

  // ---------------- validators ----------------
  private apelidoAsyncValidator(ctrl: AbstractControl): Observable<ValidationErrors | null> {
    const nickPrincipal: string = (ctrl.value ?? '').trim();

    if (nickPrincipal.length < 4) return of(null);

    const syncErrors = ctrl.errors ?? {};
    if (
      syncErrors['required'] ||
      syncErrors['minlength'] ||
      syncErrors['maxlength'] ||
      syncErrors['invalidNickname']
    ) {
      return of(null);
    }

    const fullNick = (this.apelidoCompleto() || '').trim();
    if (!fullNick) return of(null);

    // ✅ blur: modo "soft" (não trava UX por falha de rede)
    return this.validatorService.checkIfNicknameExists(fullNick, { mode: 'soft' }).pipe(
      map(exists => (exists ? { apelidoEmUso: true } : null)),
      catchError(() => of(null))
    );
  }

  getError(controlName: string): string | null {
    const ctrl = this.form.get(controlName);
    if (!ctrl || ctrl.pristine || ctrl.valid) return null;
    const errs = ctrl.errors || {};

    if (errs['required']) return 'Campo obrigatório';
    if (errs['minlength']) return `Mínimo de ${errs['minlength'].requiredLength} caracteres.`;
    if (errs['maxlength']) return `Máximo de ${errs['maxlength'].requiredLength} caracteres.`;
    if (errs['invalidNickname']) return 'Apelido contém caracteres inválidos.';
    if (errs['apelidoEmUso']) return 'Este apelido já está em uso.';
    if (controlName === 'email' && errs['email']) return 'Formato de e-mail inválido';
    if (controlName === 'password' && errs['minlength']) {
      return `Senha precisa ter ao menos ${errs['minlength'].requiredLength} caracteres.`;
    }
    return null;
  }

  // ---------------- helpers de UI ----------------
  private setBanner(variant: UiBannerVariant, title: string, message: string, details?: any) {
    let det: string | undefined = undefined;
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
    this.showTech.update(v => !v);
  }

  async syncSessionNow() {
    if (this.syncing()) return;
    this.syncing.set(true);
    try {
      await this.waitForAuthUserOnce(6000);
      const email = this.form.get('email')?.value || '';
      this.router.navigate(['/register/welcome'], { queryParams: { email, autocheck: '1' }, replaceUrl: true });
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
      aceitarTermos: false
    });
    this.banner.set(null);
    this.infoMessage.set(null);
  }

  // ---------------- submit ----------------
  onSubmit(): void {
    if (this.isLoading()) return;

    this.clearApelidoEmUsoError();

    this.form.markAllAsTouched();
    this.form.updateValueAndValidity();

    // ✅ grande plataforma: submit NÃO passa se async validator ainda está rodando
    if (this.form.pending) {
      this.errorNotification.showError('Aguarde a validação do apelido terminar.');
      return;
    }

    if (this.form.invalid) {
      this.setBanner('error', 'Verifique os campos', 'Há campos obrigatórios ou inválidos. Corrija e tente novamente.');
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
      nickname: this.apelidoCompleto(),
      acceptedTerms: { accepted: aceitarTermos, date: now },
      emailVerified: false,
      isSubscriber: false,
      firstLogin: now,
      registrationDate: now,
      profileCompleted: false
    };

    const fullNick = (payload.nickname || '').trim();

    // ✅ submit: "strict check" (se falhar rede/permissão, não assume livre)
    this.validatorService.checkIfNicknameExists(fullNick, { mode: 'strict' }).pipe(
      take(1),
      switchMap(exists => {
        if (exists) {
          return throwError(() => ({ code: 'nickname-in-use', message: 'Apelido em uso.' }));
        }
        return this.registerService.registerUser(payload, password);
      }),
      finalize(() => this.isLoading.set(false))
    ).subscribe({
      next: async () => {
        try {
          await this.waitForAuthUserOnce(8000);
        } catch (e) {
          this.creating.set(false);
          this.creatingMsg.set('Conta criada, finalizando…');
          this.setBanner(
            'warn',
            'Conta criada, mas a sessão ainda não apareceu',
            'Isso pode acontecer em conexões lentas. Você pode tentar sincronizar a sessão agora ou ir à confirmação de e-mail depois.',
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
        const rawMsg = (err?.message || '').toLowerCase();

        if (code === 'auth/unauthorized-domain' || code === 'auth/invalid-continue-uri') {
          this.setBanner(
            'error',
            'Falha ao enviar e-mail de verificação',
            'Domínio de redirecionamento não autorizado. Avise o suporte.',
            err
          );
          this.errorNotification.showError(
            'Não foi possível enviar o e-mail de verificação (domínio não autorizado).'
          );
          return;
        }

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
          const ctrl = this.form.get('apelidoPrincipal');
          ctrl?.setErrors({ ...(ctrl.errors || {}), apelidoEmUso: true });
          ctrl?.markAsTouched();
          setTimeout(() => document.getElementById('apelidoPrincipal')?.focus());
          this.setBanner('error', 'Apelido em uso', 'Escolha outro apelido para continuar.', err);
          return;
        }

        if (/verifica(ç|c)ão|enviar e-mail/.test(rawMsg)) {
          this.setBanner('warn', 'Falha ao enviar e-mail', 'Verifique sua conexão e tente novamente.', err);
          return;
        }

        this.setBanner(
          'error',
          'Não foi possível concluir o cadastro',
          'Tente novamente. Se persistir, copie os detalhes técnicos e envie ao suporte.',
          err
        );
        this.errorNotification.showError('Não foi possível concluir o cadastro. Tente novamente.');
      }
    });
  }

  reloadPage() {
    window.location.reload();
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }
}

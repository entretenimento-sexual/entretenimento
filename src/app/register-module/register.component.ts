// src/app/register-module/register.component.ts
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { Timestamp } from 'firebase/firestore';
import { Observable, of } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';

import { RegisterService } from 'src/app/core/services/autentication/register/register.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FirestoreValidationService } from 'src/app/core/services/data-handling/firestore-validation.service';
import { NicknameUtils } from 'src/app/core/utils/nickname-utils';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { IUserRegistrationData } from '../core/interfaces/iuser-registration-data';

// 🔑 mesma instância do Auth do app
import { FIREBASE_AUTH } from 'src/app/core/firebase/firebase.tokens';
import { onAuthStateChanged, type Auth, type User } from 'firebase/auth';

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

  constructor(@Inject(FIREBASE_AUTH) private auth: Auth) {
    effect(() => {
      const inUse = this.form.get('apelidoPrincipal')!.errors?.['apelidoEmUso'] === true;
      this.apelidoEmUso.set(inUse);
    });
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
    complementoApelido: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    aceitarTermos: [false, Validators.requiredTrue]
  });

  // ---------------- state ----------------
  readonly isLoading = signal(false);
  readonly showPassword = signal(false);
  readonly apelidoEmUso = signal(false);
  readonly infoMessage = signal<string | null>(null);

  // banner robusto (usuário + dev)
  readonly banner = signal<UiBanner | null>(null);
  readonly showTech = signal(false);

  // overlay “criando…”
  readonly creating = signal(false);
  readonly creatingMsg = signal('Estamos criando seu usuário, aguarde…');

  // estados de ação
  readonly syncing = signal(false);

  readonly apelidoCompleto = computed(() => {
    const p = this.form.get('apelidoPrincipal')!.value || '';
    const c = this.form.get('complementoApelido')!.value || '';
    return NicknameUtils.montarApelidoCompleto(p, c);
  });

  // espera a sessão ficar visível no onAuthStateChanged (evita “flash” de login)
  private waitForAuthUserOnce(timeoutMs = 6000): Promise<User> {
    const existing = this.auth.currentUser as User | null;
    if (existing) return Promise.resolve(existing);

    return new Promise<User>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('auth-wait-timeout')), timeoutMs);
      const unsub = onAuthStateChanged(
        this.auth,
        (u) => {
          if (u) {
            clearTimeout(timer);
            unsub();
            resolve(u);
          }
        },
        (err) => {
          clearTimeout(timer);
          unsub();
          reject(err);
        }
      );
    });
  }

  // ---------------- validators ----------------
  private apelidoAsyncValidator(ctrl: AbstractControl): Observable<ValidationErrors | null> {
    const nick: string = ctrl.value?.trim() || '';

    if (nick.length < 4) return of(null);

    if (ctrl.errors && (
      ctrl.errors['required'] ||
      ctrl.errors['minlength'] ||
      ctrl.errors['maxlength'] ||
      ctrl.errors['invalidNickname']
    )) {
      return of(null);
    }

    return this.validatorService.checkIfNicknameExists(nick).pipe(
      map(exists => exists ? { apelidoEmUso: true } : null),
      catchError(err => {
        console.log('[apelidoAsyncValidator] falha na consulta:', err);
        return of(null);
      })
    );
  }

  onNicknameTyping(): void {
    const ctrl = this.form.get('apelidoPrincipal');
    if (!ctrl) return;
    const errs = ctrl.errors;
    if (errs && Object.keys(errs).length === 1 && errs['apelidoEmUso']) {
      ctrl.setErrors(null);
    }
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
      // sessão ok → ir para welcome com autocheck
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
    this.form.markAllAsTouched();
    this.form.updateValueAndValidity();

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
    const payload: IUserRegistrationData = {
      email,
      nickname: this.apelidoCompleto(),
      acceptedTerms: { accepted: aceitarTermos, date: Timestamp.fromDate(new Date()) },
      emailVerified: false,
      isSubscriber: false,
      firstLogin: Timestamp.fromDate(new Date()),
      registrationDate: Timestamp.fromDate(new Date()),
      profileCompleted: false
    };

    this.registerService.registerUser(payload, password)
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: async () => {
          try {
            await this.waitForAuthUserOnce(8000);
          } catch (e) {
            // Não conseguiu “ver” a sessão agora → sem login! feedback com ações
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

          // Agora sim, com user disponível, podemos ir ao welcome
          this.creatingMsg.set('Tudo pronto! Redirecionando…');
          this.router.navigate(
            ['/register/welcome'],
            { queryParams: { email, autocheck: '1' }, replaceUrl: true }
          ).finally(() => this.creating.set(false));
        },
        error: (err: any) => {
          this.creating.set(false);

          // códigos conhecidos → mensagens específicas
          const code = err?.code || '';
          const rawMsg = (err?.message || '').toLowerCase();

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
            ctrl?.setErrors({ apelidoEmUso: true });
            ctrl?.markAsTouched();
            setTimeout(() => document.getElementById('apelidoPrincipal')?.focus());
            this.setBanner('error', 'Apelido em uso', 'Escolha outro apelido para continuar.', err);
            return;
          }

          if (/verifica(ç|c)ão|enviar e-mail/.test(rawMsg)) {
            this.setBanner('warn', 'Falha ao enviar e-mail', 'Verifique sua conexão e tente novamente.', err);
            return;
          }

          // genérico (com detalhes técnicos)
          this.setBanner('error', 'Não foi possível concluir o cadastro', 'Tente novamente. Se persistir, copie os detalhes técnicos e envie ao suporte.', err);
          this.errorNotification.showError('Não foi possível concluir o cadastro. Tente novamente.');
        },
      });
  }

  reloadPage() {
    window.location.reload();
  }

   togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }
}

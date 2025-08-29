// src/app/register-module/register.component.ts
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { Timestamp } from 'firebase/firestore';
import { Observable, of } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';

import { RegisterService } from 'src/app/core/services/autentication/register/register.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FirestoreValidationService } from 'src/app/core/services/data-handling/firestore-validation.service';
import { NicknameUtils } from 'src/app/core/utils/nickname-utils';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { IUserRegistrationData } from '../core/interfaces/iuser-registration-data';

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
  private emailVerification = inject(EmailVerificationService);
  private errorNotification = inject(ErrorNotificationService);
  private router = inject(Router);

  readonly form: FormGroup = this.fb.group({
    apelidoPrincipal: this.fb.control('', {
      validators: [
        Validators.required,
        Validators.minLength(4),
        Validators.maxLength(12),
        ValidatorService.nicknameValidator()
      ],
      asyncValidators: [this.apelidoAsyncValidator.bind(this)],
      updateOn: 'blur' // ✅ roda o async validator só no blur
    }),
    complementoApelido: [''],
    email: ['', [Validators.required, Validators.email]],  // updateOn padrão (change)
    password: ['', [Validators.required, Validators.minLength(6)]],
    aceitarTermos: [false, Validators.requiredTrue]
  });

  readonly isLoading = signal(false);
  readonly showPassword = signal(false);
  readonly apelidoEmUso = signal(false);
  readonly infoMessage = signal<string | null>(null);

  readonly apelidoCompleto = computed(() => {
    const p = this.form.get('apelidoPrincipal')!.value || '';
    const c = this.form.get('complementoApelido')!.value || '';
    return NicknameUtils.montarApelidoCompleto(p, c);
  });

  constructor() {
    effect(() => {
      const inUse = this.form.get('apelidoPrincipal')!.errors?.['apelidoEmUso'] === true;
      this.apelidoEmUso.set(inUse);
    });
  }

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
      // 👇 se Firestore falhar, não poluir a UI com erro trocado
      catchError(err => {
        console.log('[apelidoAsyncValidator] falha na consulta:', err);
        return of(null);
      })
    );
  }

  onNicknameTyping(): void {
    const ctrl = this.form.get('apelidoPrincipal');
    if (!ctrl) return;

    // se o único erro for "apelidoEmUso", limpa para não travar UX enquanto digita
    const errs = ctrl.errors;
    if (errs && Object.keys(errs).length === 1 && errs['apelidoEmUso']) {
      ctrl.setErrors(null);
    }
  }

  getError(controlName: string): string | null {
    const ctrl = this.form.get(controlName);
    if (!ctrl || ctrl.pristine || ctrl.valid) return null;

    // 👇 evita TypeError quando errors é null
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

  onSubmit(): void {
    console.log('[RegisterComponent] SUBMIT disparou');
    if (this.isLoading()) return;
    this.form.markAllAsTouched();
    this.form.updateValueAndValidity();

    if (this.form.invalid) {
      this.errorNotification.showError('Verifique os campos preenchidos.');
      return;
    }

    this.isLoading.set(true);
    this.infoMessage.set(null);

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
        next: () => {
          this.router.navigate(['/register/welcome'], { queryParams: { email } });
        },
        error: (err) => {
          const code = err?.code || '';
          const raw = (err?.message || '').toLowerCase();
          console.log('[RegisterComponent] erro no registro:', err);

          // 0) erros específicos do envio do e-mail de verificação
          if (code === 'auth/unauthorized-domain' || code === 'auth/invalid-continue-uri') {
            this.errorNotification.showError(
              'Não foi possível enviar o e-mail de verificação (domínio de redirecionamento não autorizado).'
            );
            return;
          }
          if (code === 'email-verification-failed') {
            this.errorNotification.showError('Não conseguimos enviar o e-mail de verificação. Tente novamente.');
            return;
          }
          if (code === 'auth/too-many-requests') {
            this.errorNotification.showError('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
            return;
          }

          // 1) apelido já em uso → inline
          if (code === 'nickname-in-use' || /apelido.*em uso/.test(raw)) {
            const ctrl = this.form.get('apelidoPrincipal');
            ctrl?.setErrors({ apelidoEmUso: true });
            ctrl?.markAsTouched();
            setTimeout(() => document.getElementById('apelidoPrincipal')?.focus());
            return;
          }

          // 2) e-mail existente → fluxo "suave"
          if (code === 'email-exists-soft') {
            this.infoMessage.set('Enviamos um e-mail para você recuperar o acesso. Verifique sua caixa de entrada e a pasta de spam.');
            setTimeout(() => document.getElementById('email')?.focus());
            return;
          }

          // 3) fallback antigo
          if (/verifica(ç|c)ão|enviar e-mail/.test(raw)) {
            this.errorNotification.showError('Não conseguimos enviar o e-mail de verificação. Verifique sua conexão e tente novamente.');
            return;
          }

          // 4) genérico
          this.errorNotification.showError('Não foi possível concluir o cadastro. Tente novamente.');
        },
      });
    }

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }
}

// src/app/register-module/register.component.ts
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router } from '@angular/router';
import { Timestamp } from 'firebase/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

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
    apelidoPrincipal: this.fb.control(
      '',
      {
        validators: [
          Validators.required,
          Validators.minLength(4),
          Validators.maxLength(12),
          ValidatorService.nicknameValidator()
        ],
        asyncValidators: [this.apelidoAsyncValidator.bind(this)],
        updateOn: 'blur'
      }
    ),
    complementoApelido: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    aceitarTermos: [false, Validators.requiredTrue]
  });

  readonly isLoading = signal(false);
  readonly showPassword = signal(false);
  readonly apelidoEmUso = signal(false);

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
        console.error('[apelidoAsyncValidator] falha na consulta:', err);
        return of(null);
      })
    );
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
    if (this.isLoading()) return;

    this.form.markAllAsTouched();

    if (this.form.invalid) {
      this.errorNotification.showError('Verifique os campos preenchidos.');
      return;
    }

    this.isLoading.set(true);
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

    this.registerService.registerUser(payload, password).subscribe({
      next: () => {
        this.emailVerification.resendVerificationEmail().subscribe(() => {
          this.router.navigate(['/welcome']);
        });
      },
      error: err => {
        this.errorNotification.showError(err.message || 'Erro no registro.');
        this.isLoading.set(false);
      }
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }
}

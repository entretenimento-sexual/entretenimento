// src\app\register-module\register.component.ts
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Timestamp } from 'firebase/firestore';
import { RegisterService } from 'src/app/core/services/autentication/register/register.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FirestoreValidationService } from 'src/app/core/services/data-handling/firestore-validation.service';
import { NicknameUtils } from 'src/app/core/utils/nickname-utils';
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
  private registerService = inject(RegisterService);
  private emailVerification = inject(EmailVerificationService);
  private errorNotification = inject(ErrorNotificationService);
  private validatorService = inject(FirestoreValidationService);
  private router = inject(Router);

  readonly form: FormGroup = this.fb.group({
    apelidoPrincipal: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(12)]],
    complementoApelido: [''],
    email: [{ value: '', disabled: false }, [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    aceitarTermos: [false, Validators.requiredTrue]
  });

  readonly isLoading = signal(false);
  readonly showPassword = signal(false);
  readonly nicknameInUse = signal(false);

  readonly apelidoCompleto = computed(() => {
    const principal = this.form.get('apelidoPrincipal')?.value || '';
    const complemento = this.form.get('complementoApelido')?.value || '';
    return NicknameUtils.montarApelidoCompleto(principal, complemento);
  });

  constructor() {
    effect(() => {
      const apelido = this.apelidoCompleto();
      // Checa a disponibilidade do apelido apenas se for válido para evitar chamadas desnecessárias
      if (apelido && apelido.length >= 4 && this.form.get('apelidoPrincipal')?.valid) {
        this.validatorService.checkIfNicknameExists(apelido).subscribe((exists: boolean) => {
          this.nicknameInUse.set(exists);
        });
      } else {
        this.nicknameInUse.set(false); // Limpa o status se o apelido for inválido
      }
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(value => !value);
  }

  getError(controlName: string): string | null {
    const control = this.form.get(controlName);
    if (!control || control.pristine || control.valid) return null;

    // Erros de validação do Angular
    if (control.errors?.['required']) return 'Campo obrigatório';
    if (control.errors?.['minlength']) return `Mínimo de ${control.errors['minlength'].requiredLength} caracteres.`;
    if (control.errors?.['maxlength']) return `Máximo de ${control.errors['maxlength'].requiredLength} caracteres.`;
    if (control.errors?.['email']) return 'Formato de e-mail inválido';

    // Erros específicos do apelido
    if (controlName === 'apelidoPrincipal' && this.nicknameInUse()) return 'Apelido já está em uso';

    // Erros genéricos de senha (ex: se o RegisterService retornar 'auth/weak-password')
    // Nota: A validação de força de senha mais robusta pode ser feita aqui ou no backend.
    if (controlName === 'password' && control.errors?.['weakPassword']) {
      return 'Senha muito fraca. Use uma combinação de letras, números e símbolos.';
    }
    return null;
  }

  onSubmit(): void {
    if (this.isLoading()) return;
    // Marca todos os controles como 'touched' para exibir mensagens de erro
    this.form.markAllAsTouched();

    if (this.form.invalid || this.nicknameInUse()) {
      this.errorNotification.showError('Verifique os campos preenchidos.');
      return;
    }

    this.isLoading.set(true);
    const apelido = this.apelidoCompleto();
    const { email, password, aceitarTermos } = this.form.getRawValue();

    const userRegistrationData: IUserRegistrationData = {
      email,
      nickname: apelido,
      acceptedTerms: {
        accepted: aceitarTermos === true,
        date: Timestamp.fromDate(new Date())
      },
      emailVerified: false,
      isSubscriber: false,
      firstLogin: Timestamp.fromDate(new Date()),
      registrationDate: Timestamp.fromDate(new Date()),
      profileCompleted: false
    };

    this.registerService.registerUser(userRegistrationData, password).subscribe({
      next: () => {
        this.emailVerification.resendVerificationEmail().subscribe(() => {
          this.router.navigate(['/welcome']);
        });
      },
      error: (err) => {
        // O GlobalErrorHandlerService já lidará com a exibição da mensagem de erro amigável.
        // Não precisamos chamar errorNotification.showError() aqui novamente,
        // pois o erro já foi propagado e tratado globalmente.
        console.log('[RegisterComponent] Erro no registro (capturado no componente):', err);
        this.isLoading.set(false);
      }
    });
  }
}

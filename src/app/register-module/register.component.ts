// src/app/authentication/register-module/register.component.ts
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidatorFn } from '@angular/forms';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { catchError, debounceTime, distinctUntilChanged, first, of, switchMap, tap } from 'rxjs';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/Register/email-verification.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RegisterService } from 'src/app/core/services/autentication/Register/register.service';
import { FirestoreValidationService } from 'src/app/core/services/data-handling/firestore-validation.service';
import { TermosECondicoesComponent } from 'src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { RegisterErrorMessagePipe } from './pipes/register-error-message.pipe';
import { CacheService } from '../core/services/general/cache/cache.service';

@Component({
  selector: 'app-register-component',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
  providers: [RegisterErrorMessagePipe],
})
export class RegisterComponent implements OnInit {
  registerForm!: FormGroup;
  isLoading = false;
  isLockedOut = false;
  formSubmitted = false;
  private failedAttempts = 0;
  private readonly maxAttempts = 5;
  private readonly lockoutTime = 30000;

  nicknameErrorMessage = signal<string | null>(null);
  complementoErrorMessage = signal<string | null>(null);

  constructor(
    private fb: FormBuilder,
    private registerService: RegisterService,
    private emailVerificationService: EmailVerificationService,
    private errorNotification: ErrorNotificationService,
    private dialog: MatDialog,
    private router: Router,
    private authService: AuthService,
    private firestoreValidationService: FirestoreValidationService,
    private cacheService: CacheService,
    private registerErrorMessagePipe: RegisterErrorMessagePipe
  ) { }

  ngOnInit(): void {
    this.initForm();
    this.monitorFormChanges();
    this.registerForm.get('email')?.disable();

    this.authService.user$.pipe(first()).subscribe((user) => {
      if (user) {
        this.registerService.getUserProgress(user.uid).subscribe({
          next: (userData) => {
            if (!userData.emailVerified) this.router.navigate(['/welcome']);
            else if (!userData.gender || !userData.estado || !userData.municipio)
              this.router.navigate(['/finalizar-cadastro']);
            else this.router.navigate(['/dashboard/principal']);
          },
          error: () => this.errorNotification.showError('Erro ao verificar o progresso do cadastro.'),
        });
      }
    });
  }

  private initForm(): void {
    this.registerForm = this.fb.group({
      apelidoPrincipal: ['', [
        Validators.required,
        Validators.minLength(4),
        Validators.maxLength(12),
        ValidatorService.nicknameValidator()
      ]],
      complementoApelido: ['', [
        Validators.maxLength(12),
        ValidatorService.complementoNicknameValidator()
      ]],
      email: ['', [Validators.required, ValidatorService.emailValidator()]],
      password: ['', [Validators.required, ValidatorService.passwordValidator()]],
      aceitarTermos: [false, Validators.requiredTrue],
    });
  }


  private monitorFormChanges(): void {
    const apelidoControl = this.registerForm.get('apelidoPrincipal');
    const complementoControl = this.registerForm.get('complementoApelido');

    // Apelido Principal
    apelidoControl?.statusChanges
      .pipe(distinctUntilChanged())
      .subscribe(() => {
        const errors = apelidoControl.errors ?? null;
        this.nicknameErrorMessage.set(this.registerErrorMessagePipe.transform(errors));
      });

    apelidoControl?.valueChanges
      .pipe(debounceTime(400), distinctUntilChanged())
      .subscribe(() => {
        this.validateNickname().subscribe(); // continua a validação do nickname
      });

    // Complemento
    complementoControl?.statusChanges
      .pipe(distinctUntilChanged())
      .subscribe(() => {
        const errors = complementoControl.errors ?? null;
        this.complementoErrorMessage.set(this.registerErrorMessagePipe.transform(errors));
      });

    complementoControl?.valueChanges
      .pipe(debounceTime(400), distinctUntilChanged())
      .subscribe();
  }


  // Feedback emitido ao perder o foco ou submeter o formulário
  onBlur(controlName: string): void {
    const control = this.registerForm.get(controlName);
    if (!control) return;

    // Para apelido, chama a validação completa
    if (controlName === 'apelidoPrincipal') {
      this.validateNickname().subscribe(() => {
        const errors = control.errors ?? null;
        this.nicknameErrorMessage.set(this.registerErrorMessagePipe.transform(errors));
      });
    } else {
      // Para complemento, só atualiza sincronicamente
      control.updateValueAndValidity();
      const errors = control.errors ?? null;
      this.complementoErrorMessage.set(this.registerErrorMessagePipe.transform(errors));
    }

    // 🔍 Log pra garantir
    console.log(`[RegisterComponent] Erros do ${controlName}:`, control.errors);
  }


  private validateNickname() {
    const apelidoControl = this.registerForm.get('apelidoPrincipal');
    const complementoControl = this.registerForm.get('complementoApelido');
    const apelido = apelidoControl?.value?.trim() || '';
    const complemento = complementoControl?.value?.trim() || '';
    const nickname = complemento ? `${apelido} ${complemento}` : apelido;

    if (apelidoControl?.invalid) {
      console.log('[validateNickname] Nickname inválido localmente. Ignorando verificação no Firestore.');
      return of(void 0);
    }

    apelidoControl?.markAsPending();

    return this.firestoreValidationService.checkIfNicknameExists(nickname).pipe(
      tap((exists) => {
        const currentErrors = apelidoControl?.errors || {};

        if (exists) {
          apelidoControl?.setErrors({ ...currentErrors, nicknameExists: true });
          this.registerForm.get('email')?.disable();
          console.warn('[validateNickname] Apelido já está em uso:', nickname);
        } else {
          const { nicknameExists, ...remainingErrors } = currentErrors;
          const hasOtherErrors = Object.keys(remainingErrors).length > 0;

          apelidoControl?.setErrors(hasOtherErrors ? remainingErrors : null);
          if (!hasOtherErrors) {
            this.registerForm.get('email')?.enable();
          }

          console.log('[validateNickname] Apelido disponível:', nickname);
        }
      }),
      catchError((err) => {
        console.error('[validateNickname] Erro ao verificar apelido no Firestore:', err);
        apelidoControl?.setErrors({ ...apelidoControl.errors, validationError: true });
        this.registerForm.get('email')?.disable();
        return of(void 0);
      })
    );
  }

  onRegister(): void {
    this.clearErrorMessages();
    this.updateAllErrorMessages(); // Garante que feedbacks apareçam

    if (this.isLockedOut || this.registerForm.invalid) {
      this.errorNotification.showError('Por favor, corrija os erros antes de continuar.');
      return;
    }

    if (!this.registerForm.get('aceitarTermos')?.value) {
      this.errorNotification.showError('Você deve aceitar os termos de uso.');
      return;
    }

    const { apelidoPrincipal, complementoApelido, email, password } = this.registerForm.value;
    const nickname = `${apelidoPrincipal} ${complementoApelido}`.trim();

    const userRegistrationData: IUserRegistrationData = {
      uid: '',
      email,
      nickname,
      photoURL: '',
      emailVerified: false,
      isSubscriber: false,
      firstLogin: new Date(),
      acceptedTerms: { accepted: true, date: new Date() },
      profileCompleted: false,
    };

    this.isLoading = true;

    this.registerService.registerUser(userRegistrationData, password)
      .pipe(first())
      .subscribe({
        next: () => {
          this.cacheService.set('tempNickname', nickname, 60000);
          this.formSubmitted = true;
          this.failedAttempts = 0;
          this.errorNotification.showSuccess('Registro realizado com sucesso! Redirecionando...');
          setTimeout(() => this.router.navigate(['/welcome']), 300);
        },
        error: (error) => this.handleRegistrationError(error),
        complete: () => {
          this.isLoading = false;
        }
      });
  }


  private updateAllErrorMessages(): void {
    this.nicknameErrorMessage.set(this.registerErrorMessagePipe.transform(this.registerForm.get('apelidoPrincipal')?.errors ?? null));
    this.complementoErrorMessage.set(this.registerErrorMessagePipe.transform(this.registerForm.get('complementoApelido')?.errors ?? null));
  }

  openTermsDialog(): void {
    this.dialog.open(TermosECondicoesComponent, { width: '600px' });
  }

  clearErrorMessages(): void {
    this.nicknameErrorMessage.set(null);
    this.complementoErrorMessage.set(null);
  }

  async resendVerificationEmail(): Promise<void> {
    try {
      await this.emailVerificationService.resendVerificationEmail();
      this.errorNotification.showSuccess(`E-mail de verificação reenviado para ${this.registerForm.get('email')?.value}.`);
    } catch {
      this.errorNotification.showError('Erro ao reenviar o e-mail de verificação.');
    }
  }

  private handleRegistrationError(error: any): void {
    this.failedAttempts++;
    if (this.failedAttempts >= this.maxAttempts) this.lockForm();

    const messages: Record<string, string> = {
      'auth/weak-password': 'A senha deve conter pelo menos 8 caracteres.',
      'auth/email-already-in-use': 'Este e-mail já está em uso.',
      'auth/invalid-email': 'Endereço de e-mail inválido.',
      'auth/network-request-failed': 'Problema de conexão.',
    };
    this.errorNotification.showError(messages[error?.message] || `Erro desconhecido. Código: ${error?.message}`);
  }

  private lockForm(): void {
    this.isLockedOut = true;
    this.errorNotification.showError('Muitas tentativas. Tente novamente em 30 segundos.');
    setTimeout(() => {
      this.isLockedOut = false;
      this.failedAttempts = 0;
    }, this.lockoutTime);
  }
}

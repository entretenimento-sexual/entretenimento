// src/app/authentication/register-module/register.component.ts
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AbstractControl, FormBuilder, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { MatDialog } from '@angular/material/dialog';
import { TermosECondicoesComponent } from 'src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component';
import { Router } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, first, map, Observable, of, switchMap, tap } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { RegisterService } from 'src/app/core/services/autentication/register/register.service';
import { FirestoreValidationService } from '../core/services/data-handling/firestore-validation.service';

@Component({
  selector: 'app-register-component',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class RegisterComponent implements OnInit {
  registerForm!: FormGroup;
  formSubmitted = false;
  isLoading = false;
  isLockedOut = false;
  nicknameValidado = false;
  emailValidado = false;
  private failedAttempts = 0;
  private readonly maxAttempts = 5;
  private readonly lockoutTime = 30000;

  constructor(
    private formBuilder: FormBuilder,
    private registerService: RegisterService,
    private emailVerificationService: EmailVerificationService,
    private errorNotification: ErrorNotificationService,
    private dialog: MatDialog,
    private router: Router,
    private authService: AuthService,
    private firestoreValidationService: FirestoreValidationService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.initForm();
    this.monitorFormChanges();
    this.registerForm.get('email')?.disable();

    this.authService.user$.pipe(first()).subscribe((user) => {
      if (user) {
        this.registerService.getUserProgress(user.uid).subscribe({
          next: (userData) => {
            if (!userData.emailVerified) {
              this.router.navigate(['/welcome']);
            } else if (!userData.gender || !userData.estado || !userData.municipio) {
              this.router.navigate(['/finalizar-cadastro']);
            } else {
              this.router.navigate(['/dashboard/principal']);
            }
          },
          error: (error) => {
            this.errorNotification.showError('Erro ao verificar o progresso do cadastro.');
          },
        });
      }
    });
  }

  private initForm(): void {
    this.registerForm = this.formBuilder.group({
      apelidoPrincipal: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(12), this.nicknameValidator()]],
      complementoApelido: ['', [Validators.maxLength(12), this.complementNicknameValidator()]],
      email: ['', [Validators.required, ValidatorService.emailValidator()]],
      password: ['', [Validators.required, ValidatorService.passwordValidator()]],
      aceitarTermos: [false, Validators.requiredTrue]
    });
  }

  private nicknameValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const nickname = control.value;
      const nicknameRegex = /^[a-zA-Z0-9!@#$%^&*()_+\-=]{4,12}$/;
      return nickname && !nicknameRegex.test(nickname) ? { 'invalidNickname': { value: nickname } } : null;
    };
  }

  private complementNicknameValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const complemento = control.value;
      const nicknameRegex = /^[a-zA-Z0-9!@#$%^&*()_+\-=]{0,12}$/;
      return complemento && !nicknameRegex.test(complemento) ? { 'invalidNickname': { value: complemento } } : null;
    };
  }

  private monitorFormChanges(): void {
    const apelidoControl = this.registerForm.get('apelidoPrincipal');
    const complementoApelidoControl = this.registerForm.get('complementoApelido');

    apelidoControl?.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      switchMap(() => this.validateNickname())
    ).subscribe();

    complementoApelidoControl?.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      switchMap(() => this.validateNickname())
    ).subscribe();
  }

  private validateNickname(): Observable<void> {
    const apelidoControl = this.registerForm.get('apelidoPrincipal');
    const complementoApelidoControl = this.registerForm.get('complementoApelido');

    const apelidoPrincipal = apelidoControl?.value?.trim() || '';
    const complementoApelido = complementoApelidoControl?.value?.trim() || '';
    const nickname = complementoApelido ? `${apelidoPrincipal} ${complementoApelido}` : apelidoPrincipal;

    if (apelidoPrincipal.length < 4 || apelidoPrincipal.length > 12) {
      apelidoControl?.setErrors({ lengthInvalid: true });
      this.nicknameValidado = false;
      this.emailValidado = false;
      this.registerForm.get('email')?.disable();
      this.cdr.markForCheck();
      return of(void 0);
    }

    apelidoControl?.markAsPending();
    this.cdr.markForCheck();

    return this.firestoreValidationService.checkIfNicknameExists(nickname).pipe(
      tap((exists: boolean) => {
        if (exists) {
          console.log('[validateNickname] Apelido já em uso.');
          apelidoControl?.setErrors({ nicknameExists: true });
          this.nicknameValidado = false;
          this.emailValidado = false;
          this.registerForm.get('email')?.disable();
          this.errorNotification.showError('Apelido já está em uso.');
        } else {
          apelidoControl?.setErrors(null);
          this.nicknameValidado = true;
          this.emailValidado = true;
          this.registerForm.get('email')?.enable();
        }
        apelidoControl?.updateValueAndValidity({ emitEvent: false });
        this.cdr.detectChanges();
      }),
      catchError((error: any) => {
        console.error('[validateNickname] Erro ao verificar apelido:', error);
        apelidoControl?.setErrors({ validationError: true });
        this.nicknameValidado = false;
        this.emailValidado = false;
        this.registerForm.get('email')?.disable();
        this.errorNotification.showError('Erro ao verificar apelido.');
        apelidoControl?.updateValueAndValidity({ emitEvent: false });
        this.cdr.detectChanges();
        return of(void 0);
      }),
      map(() => void 0)
    );
  }

  async onRegister() {
    console.log('[RegisterComponent] Tentativa de registro iniciada');

    this.clearErrorMessages();
    if (this.isLockedOut || this.registerForm.invalid) {
      console.log('[onRegister] Formulário inválido ou bloqueado:', this.registerForm.value);
      this.errorNotification.showError('Por favor, corrija os erros antes de continuar.');
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
      acceptedTerms: {
        accepted: true,
        date: new Date(),
      },
      profileCompleted: false
    };

    this.isLoading = true;
    console.log('[RegisterComponent] Dados prontos para envio:', userRegistrationData);

    try {
      await this.registerService.registerUser(userRegistrationData, password).toPromise();
      localStorage.setItem('tempNickname', nickname);
      this.formSubmitted = true;
      this.failedAttempts = 0;
      this.errorNotification.showSuccess('Registro realizado com sucesso! Redirecionando...');
      this.router.navigate(['/welcome']);
    } catch (error: any) {
      console.error('[onRegister] Erro durante o registro:', error);
      this.handleRegistrationError(error);
    } finally {
      this.isLoading = false;
    }
    console.log('[RegisterComponent] Registro concluído com sucesso. formSubmitted = true');
  }

  openTermsDialog(): void {
    this.dialog.open(TermosECondicoesComponent, { width: '600px' });
  }

  clearErrorMessages(): void {
    this.errorNotification.clearError();
  }

  async resendVerificationEmail(): Promise<void> {
    try {
      await this.emailVerificationService.resendVerificationEmail();
      this.errorNotification.showSuccess(`E-mail de verificação reenviado para ${this.registerForm.get('email')?.value}. Verifique sua caixa de entrada.`);
    } catch (error) {
      this.errorNotification.showError('Erro ao reenviar o e-mail de verificação.');
    }
  }

  handleRegistrationError(error: any): void {
    this.failedAttempts++;
    if (this.failedAttempts >= this.maxAttempts) this.lockForm();

    if (error && error.code) {
      switch (error.message) {
        case 'auth/weak-password':
          this.errorNotification.showError('A senha deve conter pelo menos 8 caracteres.');
          break;
        case 'auth/email-already-in-use':
          this.errorNotification.showError('Este e-mail já está em uso. Verifique sua caixa de entrada.');
          break;
        case 'auth/invalid-email':
          this.errorNotification.showError('Endereço de e-mail inválido.');
          break;
        case 'auth/network-request-failed':
          this.errorNotification.showError('Problema de conexão. Verifique sua rede.');
          break;
        default:
          this.errorNotification.showError(`Erro desconhecido. Código: ${error.message}`);
          break;
      }
    } else {
      this.errorNotification.showError('Erro inesperado. Tente novamente mais tarde.');
    }
  }

  lockForm(): void {
    this.isLockedOut = true;
    this.errorNotification.showError('Muitas tentativas. Tente novamente em 30 segundos.');
    setTimeout(() => {
      this.isLockedOut = false;
      this.failedAttempts = 0;
    }, this.lockoutTime);
  }
}

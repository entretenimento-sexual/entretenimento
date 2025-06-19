// src/app/register-module/register.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  signal,
  WritableSignal
} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged, filter, first, map } from 'rxjs';

import { RegisterService } from 'src/app/core/services/autentication/register/register.service';
import { FirestoreValidationService } from 'src/app/core/services/data-handling/firestore-validation.service';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RegisterErrorMessagePipe } from './pipes/register-error-message.pipe';

@Component({
  selector: 'app-register-component',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RegisterErrorMessagePipe],
})
export class RegisterComponent implements OnInit {
  form!: FormGroup;
  isLoading = false;
  submitted = false;
  showPassword = false;

  nicknameInUse: WritableSignal<boolean> = signal(false);

  constructor(
    private fb: FormBuilder,
    private registerService: RegisterService,
    private firestoreValidationService: FirestoreValidationService,
    private errorNotification: ErrorNotificationService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.form = this.fb.group({
      apelidoPrincipal: [
        '',
        [
          Validators.required,
          Validators.minLength(4),
          Validators.maxLength(12),
          ValidatorService.nicknameValidator(),
        ],
      ],
      complementoApelido: [
        '',
        [Validators.maxLength(12), ValidatorService.complementoNicknameValidator()],
      ],
      email: [
        { value: '', disabled: true },
        [Validators.required, ValidatorService.emailValidator()],
      ],
      password: ['', [Validators.required, ValidatorService.passwordValidator()]],
      aceitarTermos: [false, Validators.requiredTrue],
   });

    this.form.get('apelidoPrincipal')?.valueChanges
      .pipe(debounceTime(400), distinctUntilChanged())
      .subscribe(() => this.validateFullNickname());

    this.form.get('complementoApelido')?.valueChanges
      .pipe(debounceTime(400), distinctUntilChanged())
      .subscribe(() => this.validateFullNickname());

    this.form.get('email')?.valueChanges.pipe(
      debounceTime(600),
      filter(email => !!email && email.includes('@') && this.form.get('apelidoPrincipal')?.pristine),
      map(email => email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '')),
      distinctUntilChanged()
    ).subscribe(nick => {
      this.form.get('apelidoPrincipal')?.setValue(nick);
      });
  }

  private validateFullNickname(): void {
    const apelido = this.form.get('apelidoPrincipal')?.value?.trim() ?? '';
    const complemento = this.form.get('complementoApelido')?.value?.trim() ?? '';
    const fullNickname = `${apelido} ${complemento}`.trim().toLowerCase();

    const control = this.form.get('apelidoPrincipal');
    if (!control || control.invalid) return;

    control.markAsPending();

    this.firestoreValidationService.checkIfNicknameExists(fullNickname).pipe(first())
      .subscribe((exists) => {
        const control = this.form.get('apelidoPrincipal');
        if (!control) return;

        const currentErrors = control.errors || {};

        if (exists) {
          control.setErrors({ ...currentErrors, nicknameExists: true });
          this.form.get('email')?.disable();
          this.nicknameInUse.set(true);
        } else {
          const { nicknameExists, ...rest } = currentErrors;
          const newErrors = Object.keys(rest).length ? rest : null;
          control.setErrors(newErrors);
          if (control.valid) this.form.get('email')?.enable();
          this.nicknameInUse.set(false);
        }
      });
  }

  get f() {
    return this.form.controls;
  }

  getError(controlName: string): string | null {
    const control = this.form.get(controlName);
    if (!control || !control.touched || !control.errors) return null;

    const errors = control.errors;
    if (errors['required']) return 'Campo obrigatório';
    if (errors['minlength']) return `Mínimo de ${errors['minlength'].requiredLength} caracteres.`;
    if (errors['maxlength']) return `Máximo de ${errors['maxlength'].requiredLength} caracteres.`;
    if (errors['email']) return 'E-mail inválido';
    if (errors['password']) return 'Senha fraca';
    if (errors['invalidNickname']) return 'Apelido inválido';
    if (errors['nicknameExists']) return 'Apelido já está em uso';
    return 'Erro no campo';
  }

  onSubmit(): void {
    this.submitted = true;

    if (this.form.invalid) {
      this.errorNotification.showError('Preencha todos os campos corretamente.');
      return;
    }

    const apelidoPrincipal = this.form.get('apelidoPrincipal')?.value?.trim();
    const complementoApelido = this.form.get('complementoApelido')?.value?.trim();
    const apelidoCompleto = `${apelidoPrincipal} ${complementoApelido}`.trim();
    const email = this.form.get('email')?.value;
    const password = this.form.get('password')?.value;

    this.isLoading = true;

    this.registerService
      .registerUser(
        {
          email,
          nickname: apelidoCompleto,
          photoURL: '',
          emailVerified: false,
          isSubscriber: false,
          firstLogin: new Date(),
          acceptedTerms: { accepted: true, date: new Date() },
          profileCompleted: false,
        },
        password
      )
      .subscribe({
        next: () => {
          this.errorNotification.showSuccess('Cadastro realizado com sucesso!');
          this.router.navigate(['/welcome']);
        },
        error: (err) => {
          this.errorNotification.showError('Erro no cadastro: ' + err?.message);
          this.isLoading = false;
        },
      });
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }
}

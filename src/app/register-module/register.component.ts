// register.component.ts (versão com verificação reativa de nickname completo)
import { ChangeDetectionStrategy, Component, OnInit, computed, signal, WritableSignal } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { RegisterService } from 'src/app/core/services/autentication/register/register.service';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RegisterErrorMessagePipe } from './pipes/register-error-message.pipe';
import { FirestoreValidationService } from 'src/app/core/services/data-handling/firestore-validation.service';
import { debounceTime, distinctUntilChanged, first } from 'rxjs';

@Component({
  selector: 'app-register-component',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
  providers: [RegisterErrorMessagePipe],
})
export class RegisterComponent implements OnInit {
  form!: FormGroup;
  isLoading = false;
  submitted = false;

  nicknameInUse: WritableSignal<boolean> = signal(false);

  constructor(
    private fb: FormBuilder,
    private registerService: RegisterService,
    private errorNotification: ErrorNotificationService,
    private firestoreValidationService: FirestoreValidationService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.form = this.fb.group({
      apelidoPrincipal: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(12), ValidatorService.nicknameValidator()]],
      complementoApelido: ['', [Validators.maxLength(12), ValidatorService.complementoNicknameValidator()]],
      email: [{ value: '', disabled: true }, [Validators.required, ValidatorService.emailValidator()]],
      password: ['', [Validators.required, ValidatorService.passwordValidator()]],
      aceitarTermos: [false, Validators.requiredTrue]
    });

    this.form.get('apelidoPrincipal')?.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged()
    ).subscribe(() => this.validateFullNickname());

    this.form.get('complementoApelido')?.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged()
    ).subscribe(() => this.validateFullNickname());
  }

  private validateFullNickname(): void {
    const apelido = this.form.get('apelidoPrincipal')?.value?.trim() ?? '';
    const complemento = this.form.get('complementoApelido')?.value?.trim() ?? '';
    const fullNickname = `${apelido} ${complemento}`.trim().toLowerCase();

    if (this.form.get('apelidoPrincipal')?.invalid) return;

    this.form.get('apelidoPrincipal')?.markAsPending();

    this.firestoreValidationService.checkIfNicknameExists(fullNickname).pipe(first()).subscribe(exists => {
      const apelidoControl = this.form.get('apelidoPrincipal');
      const currentErrors = apelidoControl?.errors || {};

      if (exists) {
        apelidoControl?.setErrors({ ...currentErrors, nicknameExists: true });
        this.form.get('email')?.disable();
        this.nicknameInUse.set(true);
      } else {
        const { nicknameExists, ...rest } = currentErrors;
        apelidoControl?.setErrors(Object.keys(rest).length ? rest : null);
        if (apelidoControl?.valid) this.form.get('email')?.enable();
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
    if (errors['nicknameExists']) return 'Apelido já usado';
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
    const apelido = `${apelidoPrincipal} ${complementoApelido}`.trim();
    const email = this.form.get('email')?.value;
    const password = this.form.get('password')?.value;

    this.isLoading = true;

    this.registerService.registerUser({
      uid: '',
      email,
      nickname: apelido,
      photoURL: '',
      emailVerified: false,
      isSubscriber: false,
      firstLogin: new Date(),
      acceptedTerms: { accepted: true, date: new Date() },
      profileCompleted: false,
    }, password).subscribe({
      next: () => {
        this.errorNotification.showSuccess('Cadastro realizado com sucesso!');
        this.router.navigate(['/welcome']);
      },
      error: (err) => {
        this.errorNotification.showError('Erro no cadastro: ' + err?.message);
        this.isLoading = false;
      }
    });
  }
}

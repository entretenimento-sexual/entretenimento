// src/app/register-module/register-ui/register-ui.component.ts
import { Component, EventEmitter, Output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NicknameFieldComponent } from './fields/nickname-field/nickname-field.component';
import { FormSuccessMessageComponent } from './feedback/form-success-message/form-success-message.component';

@Component({
  selector: 'app-register-ui',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NicknameFieldComponent,
    FormSuccessMessageComponent,
  ],
  templateUrl: './register-ui.component.html',
  styleUrls: ['./register-ui.component.css'],
})
export class RegisterUiComponent {
  form = input<FormGroup>();
  isLoading = input<boolean>();
  isLockedOut = input<boolean>();
  readonly nicknameValidado = input<boolean>(false);
  readonly emailValidado = input<boolean>(false);
  readonly formSubmitted = input<boolean>(false);

  @Output() submitForm = new EventEmitter<void>();
  @Output() openTerms = new EventEmitter<void>();
  @Output() resendEmail = new EventEmitter<void>();

  onSubmit(): void {
    console.log('[RegisterUiComponent] Submissão do formulário detectada.');
    if (!this.allFieldsValid()) {
      console.warn('[RegisterUiComponent] Formulário incompleto ou inválido:', this.form()?.value);
      return;
    }
    this.submitForm.emit();
  }

  formInvalid(): boolean {
    return !this.allFieldsValid();
  }

  private allFieldsValid(): boolean {
    const f = this.form();
    if (!f) return false;

    return (
      (f.valid ?? false) &&
      this.nicknameValidado() &&
      this.emailValidado() &&
      (f.get('apelidoPrincipal')?.valid ?? false) &&
      (f.get('complementoApelido')?.valid ?? true) &&
      (f.get('email')?.valid ?? false) &&
      (f.get('password')?.valid ?? false) &&
      (f.get('aceitarTermos')?.value === true)
    );
  }

  shouldShowSuccessMessage(): boolean {
    const f = this.form();
    return this.formSubmitted() && this.emailValidado() && f?.get('email')?.value;
  }
}

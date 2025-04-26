// src/app/register-module/register-ui/fields/nickname-field/nickname-field.component.ts
import { Component, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule, AbstractControl } from '@angular/forms';

@Component({
  selector: 'app-nickname-field',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './nickname-field.component.html',
  styleUrls: ['./nickname-field.component.css'],
})
export class NicknameFieldComponent {
  form = input.required<FormGroup>();

  private apelidoMessage = signal<string | null>(null);
  private complementoMessage = signal<string | null>(null);
  private apelidoInactivityTimeout: any = null;

  getControl(controlName: string): AbstractControl | null {
    return this.form().get(controlName);
  }

  getTooltipMessage(controlName: string): string | null {
    return controlName === 'apelidoPrincipal'
      ? this.apelidoMessage()
      : this.complementoMessage();
  }

  onInput(controlName: string): void {
    const control = this.getControl(controlName);
    if (!control) return;

    const errors = control.errors;
    if (!errors) {
      this.clearTooltip(controlName);
      return;
    }

    if (controlName === 'apelidoPrincipal') {
      if (this.apelidoInactivityTimeout) clearTimeout(this.apelidoInactivityTimeout);

      if (errors['maxlength']) {
        this.apelidoMessage.set('Máximo de 12 caracteres.');
      } else if (errors['nicknameExists']) {
        this.apelidoMessage.set('Apelido já em uso.');
      } else if (errors['minlength']) {
        this.apelidoMessage.set(null); // Aguarda inércia
        this.apelidoInactivityTimeout = setTimeout(() => {
          this.apelidoMessage.set('Mínimo de 4 caracteres.');
        }, 3000);
      } else if (errors['invalidNickname']) {
        this.apelidoMessage.set('Caracteres inválidos.');
      } else {
        this.apelidoMessage.set(null);
      }
    }

    if (controlName === 'complementoApelido') {
      if (errors['maxlength']) {
        this.complementoMessage.set('Máximo 12 caracteres.');
      } else if (errors['invalidNickname']) {
        this.complementoMessage.set('Caracteres inválidos.');
      } else {
        this.complementoMessage.set(null);
      }
    }
  }

  onBlur(controlName: string): void {
    const control = this.getControl(controlName);
    if (!control) return;

    const errors = control.errors;
    if (controlName === 'apelidoPrincipal' && errors?.['minlength']) {
      this.apelidoMessage.set('Mínimo de 4 caracteres.'); // Exibe ao blur
    }
  }

  private clearTooltip(controlName: string): void {
    if (controlName === 'apelidoPrincipal') {
      this.apelidoMessage.set(null);
    } else if (controlName === 'complementoApelido') {
      this.complementoMessage.set(null);
    }
  }

  resetFieldTouched(controlName: string): void {
    const control = this.getControl(controlName);
    if (control?.touched) {
      control.markAsUntouched();
    }
  }
}

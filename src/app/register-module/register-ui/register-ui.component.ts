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
  nicknameValidado = input<boolean>();
  emailValidado = input<boolean>();

  @Output() submitForm = new EventEmitter<void>();
  @Output() openTerms = new EventEmitter<void>();
  @Output() resendEmail = new EventEmitter<void>();

  formSubmitted = false;
}

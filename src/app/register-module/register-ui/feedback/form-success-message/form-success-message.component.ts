// src/app/register-module/register-ui/feedback/form-success-message/form-success-message.component.ts
import { Component, input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-form-success-message',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './form-success-message.component.html',
  styleUrls: ['./form-success-message.component.css']
})
export class FormSuccessMessageComponent {
  form = input<any>();
  @Output() resendEmail = new EventEmitter<void>();
}

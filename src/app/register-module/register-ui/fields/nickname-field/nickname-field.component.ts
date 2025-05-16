// src/app/register-module/register-ui/fields/nickname-field/nickname-field.component.ts
import { Component, EventEmitter, Input, Output, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-nickname-field',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './nickname-field.component.html',
  styleUrls: ['./nickname-field.component.css'],
})
export class NicknameFieldComponent {
  @Input() form!: FormGroup;
  @Input() nicknameErrorMessage!: string | null;
  @Input() complementoErrorMessage!: string | null;
  @Output() blurField = new EventEmitter<string>();

  // Signals locais para log
  nicknameMessage = signal<string | null>(null);
  complementoMessage = signal<string | null>(null);

  constructor() {
    // Efeito para observar nicknameErrorMessage vindo de fora
    effect(() => {
      const msg = this.nicknameErrorMessage;
      console.log('[NicknameFieldComponent] nicknameErrorMessage atualizado:', msg);
      this.nicknameMessage.set(msg);
    });

    // Efeito para observar complementoErrorMessage
    effect(() => {
      const msg = this.complementoErrorMessage;
      console.log('[NicknameFieldComponent] complementoErrorMessage atualizado:', msg);
      this.complementoMessage.set(msg);
    });
  }

  emitBlur(controlName: string): void {
    console.log('[NicknameFieldComponent] Campo perdeu o foco:', controlName);
    this.blurField.emit(controlName);
  }
}

// src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component.ts
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

export interface ConfirmacaoDialogData {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

@Component({
  selector: 'app-confirmacao-dialog',
  templateUrl: './confirmacao-dialog.component.html',
  styleUrls: ['./confirmacao-dialog.component.css'],
  standalone: false,
})
export class ConfirmacaoDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA)
    public readonly data: ConfirmacaoDialogData
  ) {}

  get title(): string {
    return String(this.data?.title ?? '').trim() || 'Confirmar ação';
  }

  get message(): string {
    return String(this.data?.message ?? '').trim() || 'Deseja continuar?';
  }

  get confirmLabel(): string {
    return String(this.data?.confirmLabel ?? '').trim() || 'Confirmar';
  }

  get cancelLabel(): string {
    return String(this.data?.cancelLabel ?? '').trim() || 'Cancelar';
  }

  get isDanger(): boolean {
    return this.data?.tone === 'danger';
  }
}

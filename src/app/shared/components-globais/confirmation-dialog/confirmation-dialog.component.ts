// src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component.ts
// -----------------------------------------------------------------------------
// CONFIRMATION DIALOG COMPONENT
// -----------------------------------------------------------------------------
// Modal global para confirmação de ações sensíveis.
//
// Uso recomendado:
// - desfazer amizade;
// - bloquear usuário;
// - excluir foto;
// - cancelar convite;
// - sair de sala/grupo;
// - qualquer ação que precise de decisão explícita do usuário.
//
// Segurança/UX:
// - substitui window.confirm(), que é pobre visualmente e pouco controlável;
// - mantém foco preso no dialog via MatDialog;
// - usa aria-labels/textos explícitos;
// - retorna boolean: true confirma, false cancela.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import { Component, Inject, computed } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { SharedMaterialModule } from 'src/app/shared/shared-material.module';

export type ConfirmationDialogTone = 'danger' | 'warning' | 'info' | 'success';

export interface ConfirmationDialogData {
  title: string;
  message: string;

  confirmLabel?: string;
  cancelLabel?: string;

  eyebrow?: string;
  icon?: string;
  tone?: ConfirmationDialogTone;

  /**
   * Texto auxiliar menor.
   * Bom para explicar consequência sem carregar o parágrafo principal.
   */
  detail?: string;
}

@Component({
  selector: 'app-confirmation-dialog',
  standalone: true,
  imports: [
    CommonModule,
    SharedMaterialModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
  ],
  templateUrl: './confirmation-dialog.component.html',
  styleUrls: ['./confirmation-dialog.component.css'],
})
export class ConfirmationDialogComponent {
  readonly tone = computed<ConfirmationDialogTone>(() => this.data.tone ?? 'warning');
  readonly icon = computed(() => this.data.icon ?? this.resolveDefaultIcon(this.tone()));
  readonly confirmLabel = computed(() => this.data.confirmLabel ?? 'Confirmar');
  readonly cancelLabel = computed(() => this.data.cancelLabel ?? 'Cancelar');

  constructor(
    private readonly ref: MatDialogRef<ConfirmationDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: ConfirmationDialogData
  ) {}

  confirm(): void {
    this.ref.close(true);
  }

  cancel(): void {
    this.ref.close(false);
  }

  private resolveDefaultIcon(tone: ConfirmationDialogTone): string {
    switch (tone) {
      case 'danger':
        return 'warning';
      case 'success':
        return 'check_circle';
      case 'info':
        return 'info';
      case 'warning':
      default:
        return 'shield';
    }
  }
}
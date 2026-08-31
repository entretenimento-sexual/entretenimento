// src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component.ts
// -----------------------------------------------------------------------------
// CONFIRMATION DIALOG COMPONENT
// -----------------------------------------------------------------------------
// Modal global para confirmação de ações sensíveis e feedback bloqueante.
//
// Uso recomendado:
// - desfazer amizade/conexão;
// - bloquear usuário;
// - excluir foto;
// - cancelar convite;
// - sair de sala/grupo;
// - qualquer ação que precise de decisão explícita do usuário;
// - feedback bloqueante que exija uma única ação de reconhecimento.
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
  /** `false` transforma o modal em feedback de ação única. */
  showCancel?: boolean;

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
  readonly title = computed(() => this.cleanLabel(this.data?.title, 'Confirmar ação'));
  readonly message = computed(() => this.cleanLabel(this.data?.message, 'Deseja continuar?'));

  /**
   * Normaliza payloads legados. O antigo ConfirmacaoDialogComponent aceitava
   * `tone: 'default'`; ao passar pelo adaptador isso deve virar warning em vez
   * de produzir um estado visual sem accent.
   */
  readonly tone = computed<ConfirmationDialogTone>(() =>
    this.resolveTone((this.data as { tone?: unknown } | null)?.tone)
  );
  readonly icon = computed(() => this.data?.icon ?? this.resolveDefaultIcon(this.tone()));
  readonly confirmLabel = computed(() => this.cleanLabel(this.data?.confirmLabel, 'Confirmar'));
  readonly cancelLabel = computed(() => this.cleanLabel(this.data?.cancelLabel, 'Cancelar'));

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

  private resolveTone(value: unknown): ConfirmationDialogTone {
    switch (value) {
      case 'danger':
      case 'info':
      case 'success':
      case 'warning':
        return value;
      default:
        return 'warning';
    }
  }

  private cleanLabel(value: unknown, fallback: string): string {
    const label = typeof value === 'string' ? value.trim() : '';
    return label || fallback;
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

// src/app/chat-module/modals/base-modal/base-modal.component.ts
// -----------------------------------------------------------------------------
// BASE MODAL PRESENTATION SHELL
// -----------------------------------------------------------------------------
// O overlay, o foco preso e a restauração de foco pertencem ao MatDialog.
// Este componente fornece apenas estrutura visual e semântica compartilhada.
// -----------------------------------------------------------------------------
import {
  Component,
  EventEmitter,
  Output,
  inject,
  input,
} from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-base-modal',
  templateUrl: './base-modal.component.html',
  styleUrls: ['./base-modal.component.css'],
  standalone: true,
  imports: [],
})
export class BaseModalComponent {
  private static nextTitleId = 0;
  private readonly dialogRef = inject(MatDialogRef, { optional: true });

  readonly title = input<string>('');
  readonly titleId = `base-modal-title-${BaseModalComponent.nextTitleId += 1}`;

  @Output() closeModal = new EventEmitter<void>();

  constructor() {
    this.dialogRef?.updateSize('min(92vw, 40rem)');
  }

  onClose(): void {
    this.closeModal.emit();
  }
}

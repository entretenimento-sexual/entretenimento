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
  input,
} from '@angular/core';

@Component({
  selector: 'app-base-modal',
  templateUrl: './base-modal.component.html',
  styleUrls: ['./base-modal.component.css'],
  standalone: true,
  imports: [],
})
export class BaseModalComponent {
  private static nextTitleId = 0;

  readonly title = input<string>('');
  readonly titleId = `base-modal-title-${BaseModalComponent.nextTitleId += 1}`;

  @Output() closeModal = new EventEmitter<void>();

  onClose(): void {
    this.closeModal.emit();
  }
}

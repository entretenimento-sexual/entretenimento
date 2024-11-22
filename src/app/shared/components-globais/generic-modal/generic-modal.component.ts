//src\app\shared\components-globais\generic-modal\generic-modal.component.ts
import { Component, Input, EventEmitter, Output, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

@Component({
    selector: 'app-generic-modal',
    templateUrl: './generic-modal.component.html',
    styleUrls: ['./generic-modal.component.css'],
    standalone: false
})
export class GenericModalComponent {

  constructor(
    public dialogRef: MatDialogRef<GenericModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { message: string, titulo?: string }
  ) { }

  @Input() titulo: string = '';
  @Input() exibir: boolean = false;
  @Input() mensagemErro: string = '';
  @Output() fecharModal = new EventEmitter<void>();

  fechar(): void {
    this.fecharModal.emit();
  }
}

//src\app\shared\components-globais\foto-preview-modal\foto-preview-modal.component.ts
import { Component, Inject, Input } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

interface FotoModalData {
  fotoUrl: string | ArrayBuffer | null;
  file: File | Blob | null; // Adicione o tipo File ou Blob
}

@Component({
  selector: 'app-foto-preview-modal',
  templateUrl: './foto-preview-modal.component.html',
  styleUrls: ['./foto-preview-modal.component.css']
})
export class FotoPreviewModalComponent {

  constructor(
  @Inject(MAT_DIALOG_DATA)
    public data: { fotoUrl: string | ArrayBuffer | null, file: File | Blob | null },
    private dialogRef: MatDialogRef<FotoPreviewModalComponent>) { }

  // Métodos para editar, excluir, salvar a foto
  editarFoto() {
    // Implementação da edição
    alert('Editar foto não implementado');
  }

  excluirFoto() {
    // Implementação da exclusão
    alert('Excluir foto não implementado');
  }

  salvarFoto() {
    if (this.data.file) {
      this.dialogRef.close({ action: 'salvar', file: this.data.file });
    } else {
      console.error('Nenhum arquivo disponível para salvar');
    }
  }

  excluirFotoEFechar() {
    this.dialogRef.close('excluir');
  }
}

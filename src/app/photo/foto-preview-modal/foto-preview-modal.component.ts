//src\app\photo\foto-preview-modal\foto-preview-modal.component.ts
import { Component, Inject, Input } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TextoDialogComponent } from '../../shared/components-globais/texto-dialog/texto-dialog.component';
import { ConfirmacaoDialogComponent } from '../../shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { PhotoEditorComponent } from '../photo-editor/photo-editor.component';

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
    private dialogRef: MatDialogRef<FotoPreviewModalComponent>,
    private dialog: MatDialog
    ) { }

  // Métodos para editar, excluir, salvar a foto
  editarFoto() {
    const dialogRef = this.dialog.open(PhotoEditorComponent, {
      width: '70%',
      height: '70%',
      data: { file: this.data.file }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && result.action === 'salvar') {
        // Atualize a foto exibida com a foto editada
        this.data.file = result.file;
        this.data.fotoUrl = URL.createObjectURL(result.file);
      }
    });
  }

  excluirFoto() {
    // Implementação da exclusão
    alert('Excluir foto não implementado');
  }

  salvarFoto(): void {
    const dialogRef = this.dialog.open(TextoDialogComponent, {
      width: '450px',
      data: { file: this.data.file } // Passando o arquivo como dado
    });

    dialogRef.afterClosed().subscribe(descricao => {
      if (descricao !== undefined) {
        // O usuário clicou em "Salvar Foto" e pode ter adicionado uma descrição
        this.dialogRef.close({ action: 'salvar', file: this.data.file, descricao: descricao });
      }
    });
  }

  confirmarSalvarFoto(descricao: string): void {
    const confirmDialogRef = this.dialog.open(ConfirmacaoDialogComponent, {
      width: '350px',
      data: { message: "Tem certeza que deseja salvar esta foto com a descrição fornecida?" }
    });

    confirmDialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        // Proceda com o salvamento da foto e descrição
        this.dialogRef.close({ action: 'salvar', file: this.data.file, descricao });
      }
    });
  }

  excluirFotoEFechar() {
    this.dialogRef.close('excluir');
  }
}


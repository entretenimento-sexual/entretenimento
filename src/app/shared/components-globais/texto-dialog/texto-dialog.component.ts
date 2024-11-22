//src\app\shared\components-globais\texto-dialog\texto-dialog.component.ts
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

@Component({
    selector: 'app-texto-dialog',
    templateUrl: './texto-dialog.component.html',
    styleUrl: './texto-dialog.component.css',
    standalone: false
})
export class TextoDialogComponent {
  public descricao: string = '';

  constructor(
    public dialogRef: MatDialogRef<TextoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any) { }

  confirmar(): void {
    this.dialogRef.close(this.descricao);
  }
}



//src\app\admin-dashboard\shared\confirm-dialog\confirm-dialog.component.ts
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogContent, MatDialogActions } from '@angular/material/dialog';

export interface ConfirmData { title?: string; message?: string; confirmText?: string; cancelText?: string; }

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  template: `
<h2 mat-dialog-title>{{ data.title || 'Confirmar' }}</h2>
<mat-dialog-content>{{ data.message || 'Tem certeza?' }}</mat-dialog-content>
<mat-dialog-actions align="end">
<button mat-button (click)="dialogRef.close(false)">{{ data.cancelText || 'Cancelar' }}</button>
<button mat-raised-button color="primary" (click)="dialogRef.close(true)">{{ data.confirmText || 'Confirmar' }}</button>
</mat-dialog-actions>
`,
  imports: [MatDialogContent, MatDialogActions],
})

export class ConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmData
  ) { }
}

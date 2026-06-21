// src/app/chat-module/modals/delete-message-confirm-dialog/delete-message-confirm-dialog.component.ts
// -----------------------------------------------------------------------------
// DeleteMessageConfirmDialogComponent
// -----------------------------------------------------------------------------
// Confirmação visual para soft delete de mensagem direta.
//
// Decisão:
// - substituir window.confirm por modal integrado ao app;
// - manter texto objetivo e acessível;
// - ação destrutiva exige confirmação explícita.
// -----------------------------------------------------------------------------

import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-delete-message-confirm-dialog',
  templateUrl: './delete-message-confirm-dialog.component.html',
  styleUrls: ['./delete-message-confirm-dialog.component.css'],
  standalone: false,
})
export class DeleteMessageConfirmDialogComponent {
  constructor(
    private readonly dialogRef: MatDialogRef<DeleteMessageConfirmDialogComponent, boolean>
  ) {}

  cancel(): void {
    this.dialogRef.close(false);
  }

  confirm(): void {
    this.dialogRef.close(true);
  }
}

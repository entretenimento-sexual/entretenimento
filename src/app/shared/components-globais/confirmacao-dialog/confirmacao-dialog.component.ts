// src\app\shared\components-globais\confirmacao-dialog\confirmacao-dialog.component.ts
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

@Component({
  selector: 'app-confirmacao-dialog',
  templateUrl: './confirmacao-dialog.component.html',
  styleUrls: ['./confirmacao-dialog.component.css']
})
export class ConfirmacaoDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: any) { }
}



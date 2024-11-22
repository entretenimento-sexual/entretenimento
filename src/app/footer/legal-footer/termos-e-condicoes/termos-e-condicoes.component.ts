//src\app\footer\legal-footer\termos-e-condicoes\termos-e-condicoes.component.ts
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

@Component({
    selector: 'app-termos-e-condicoes',
    imports: [CommonModule],
    templateUrl: './termos-e-condicoes.component.html',
    styleUrls: ['./termos-e-condicoes.component.css']
})
export class TermosECondicoesComponent {
  constructor(private dialogRef: MatDialogRef<TermosECondicoesComponent>) { }

  closeDialog() {
    this.dialogRef.close();
  }
}

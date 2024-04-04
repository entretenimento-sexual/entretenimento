//src\app\footer\legal-footer\legal-footer.component.ts
import { Component } from '@angular/core';
import { TermosECondicoesComponent } from './termos-e-condicoes/termos-e-condicoes.component';
import { MatDialog } from '@angular/material/dialog';



@Component({
  selector: 'app-legal-footer',
  templateUrl: './legal-footer.component.html',
  styleUrls: ['./legal-footer.component.css', '../footer-shared.css']
})

export class LegalFooterComponent {
  constructor(public dialog: MatDialog) { }

  openTermsAndConditions() {
    const dialogRef = this.dialog.open(TermosECondicoesComponent, {
      width: '40%',
      // outras configurações se necessário
    });
  }
}

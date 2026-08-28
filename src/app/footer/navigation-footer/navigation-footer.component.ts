//src\app\footer\navigation-footer\navigation-footer.component.ts
import { Component } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TermosECondicoesComponent } from '../legal-footer/termos-e-condicoes/termos-e-condicoes.component';

@Component({
    selector: 'app-navigation-footer',
    templateUrl: './navigation-footer.component.html',
    styleUrls: ['./navigation-footer.component.css', '../footer-shared.css'],
    standalone: false
})
export class NavigationFooterComponent {
  constructor(public dialog: MatDialog) { }

  openTermsAndConditions() {
    const dialogRef = this.dialog.open(TermosECondicoesComponent, {
      width: '40%',
      // outras configurações se necessário
    });
  }
}


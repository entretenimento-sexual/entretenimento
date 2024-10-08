//src\app\footer\legal-footer\legal-footer.component.ts
import { Component } from '@angular/core';
import { TermosECondicoesComponent } from './termos-e-condicoes/termos-e-condicoes.component';
import { MatDialog } from '@angular/material/dialog';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-legal-footer',
  templateUrl: './legal-footer.component.html',
  styleUrls: ['./legal-footer.component.css', '../footer-shared.css']
})

export class LegalFooterComponent {
  constructor(public dialog: MatDialog,
              private errorNotificationService: ErrorNotificationService) { }

  openTermsAndConditions() {
    try {
      const dialogRef = this.dialog.open(TermosECondicoesComponent, {
        width: '40%',
        // outras configurações se necessário
      });
    } catch (error: any) {
      // Log do erro e feedback ao usuário
      console.error('Erro ao abrir os Termos e Condições:', error);
      // Exibir mensagem amigável ao usuário
      this.errorNotificationService.showError('Não foi possível abrir os Termos e Condições. Por favor, tente novamente mais tarde.');
    }
  }
}

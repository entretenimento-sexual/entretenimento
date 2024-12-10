//src\app\shared\user-card\user-card.component.ts
import { Component, Input } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { DateFormatPipe } from 'src/app/shared/date-format.pipe';
import { ModalMensagemComponent } from '../components-globais/modal-mensagem/modal-mensagem.component';
import { MatDialog } from '@angular/material/dialog';

@Component({
    selector: 'app-user-card',
    templateUrl: './user-card.component.html',
    styleUrls: ['./user-card.component.css'],
    providers: [DateFormatPipe], // Adiciona o pipe como provedor do componente
    standalone: false
})
export class UserCardComponent {
  @Input() user!: IUserDados | null;
  @Input() distanciaKm: number | null = null;

  constructor(private dateFormatPipe: DateFormatPipe,
              private dialog: MatDialog) { }

  ngOnChanges() {
    console.log('User:', this.user);
    console.log('Distância recebida:', this.distanciaKm);
  }


  abrirModal(event: Event): void {
    event.preventDefault(); // Evita que o link navegue para outra página

    if (this.user) {
      this.dialog.open(ModalMensagemComponent, {
        width: '400px',
        data: { profile: this.user }
      });
    }
  }

  getUserNicknameClass(user: IUserDados | null): string {
    if (!user || !user.lastLogin) {
      return '';
    }

    const now = new Date();
    const lastLogin = this.dateFormatPipe.transform(user.lastLogin, 'datetime');

    // Converte a data formatada de volta para um objeto Date para calcular a diferença de dias
    const lastLoginDate = new Date(lastLogin);
    const daysSinceLastLogin = Math.floor((now.getTime() - lastLoginDate.getTime()) / (1000 * 60 * 60 * 24));

    if (user.isOnline) {
      return 'nickname-online';
    } else if (daysSinceLastLogin <= 7) { // Usuários recentes (últimos 7 dias)
      return 'nickname-recent';
    } else if (daysSinceLastLogin > 30) { // Usuários inativos (mais de 30 dias)
      return 'nickname-inactive';
    } else {
      return 'nickname-offline';
    }
  }
}

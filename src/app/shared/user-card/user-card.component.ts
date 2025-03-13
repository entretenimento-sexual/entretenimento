//src\app\shared\user-card\user-card.component.ts
import { Component, Input } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { DateFormatPipe } from 'src/app/shared/date-format.pipe';
import { ModalMensagemComponent } from '../components-globais/modal-mensagem/modal-mensagem.component';
import { MatDialog } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import { AppState } from 'src/app/store/states/app.state';
import { Store } from '@ngrx/store';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { sendFriendRequest } from 'src/app/store/actions/actions.interactions/actions.friends';

@Component({
    selector: 'app-user-card',
    templateUrl: './user-card.component.html',
    styleUrls: ['./user-card.component.css'],
    providers: [DateFormatPipe], // Adiciona o pipe como provedor do componente
    standalone: true,
    imports: [CommonModule, RouterModule]
})
export class UserCardComponent {
  @Input() user!: IUserDados | null;
  @Input() distanciaKm: number | null = null;

  constructor(private dateFormatPipe: DateFormatPipe,
              private dialog: MatDialog,
              private store: Store<AppState>,
              private errorNotifier: ErrorNotificationService,
              private userInteractionsService: UserInteractionsService) { }

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

  adicionarAmigo(): void {
    if (!this.user) return;

    this.userInteractionsService.sendFriendRequest('meuUid', this.user.uid).subscribe({
      next: () => {
        this.store.dispatch(sendFriendRequest({ userUid: 'meuUid', friendUid: this.user!.uid }));
        this.errorNotifier.showSuccess(`Solicitação de amizade enviada para ${this.user?.nickname || 'usuário'}!`);
      },
      error: (err) => {
        this.errorNotifier.showError('Erro ao enviar solicitação de amizade.', err.message);
      }
    });
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

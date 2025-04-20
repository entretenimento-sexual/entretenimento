//src\app\shared\components-globais\user-card\detailed-user-card\detailed-user-card.component.ts
import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { BaseUserCardComponent } from '../base-user-card/base-user-card.component';
import { MatDialog } from '@angular/material/dialog';
import { ModalMensagemComponent } from '../../modal-mensagem/modal-mensagem.component';

@Component({
  selector: 'app-detailed-user-card',
  imports: [CommonModule, BaseUserCardComponent],
  templateUrl: './detailed-user-card.component.html',
  styleUrl: './detailed-user-card.component.css'
})

export class DetailedUserCardComponent {
  readonly user = input.required<IUserDados>();

  constructor(private dialog: MatDialog) { }

  sendMessage(user: IUserDados): void {
    this.dialog.open(ModalMensagemComponent, {
      width: '400px',
      data: { profile: user }
    });
  }

  sendFriendRequest(user: IUserDados): void {
    console.log(`Solicitação de amizade enviada para ${user.nickname}`);
  }
}

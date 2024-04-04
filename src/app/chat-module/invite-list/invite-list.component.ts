//src\app\chat-module\invite-list\invite-list.component.ts
import { Component, OnInit } from '@angular/core';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { InviteService } from 'src/app/core/services/batepapo/invite.service';


@Component({
  selector: 'app-invite-list',
  templateUrl: './invite-list.component.html',
  styleUrls: ['./invite-list.component.css']
})
export class InviteListComponent implements OnInit {
  invites: Invite[] = [];

  constructor(private inviteService: InviteService) { }

  ngOnInit() {
    this.loadInvites();
  }

  loadInvites() {
    // Supondo que você tenha uma maneira de obter o ID do usuário atual
    const userId = 'ID_DO_USUÁRIO_ATUAL';
    this.inviteService.getInvitesByUser(userId).subscribe(invites => {
      this.invites = invites;
    });
  }

  acceptInvite(inviteId: string | undefined) {
    if (!inviteId) {
      console.error('Erro: inviteId é undefined.');
      return;
    }
    this.inviteService.updateInviteStatus(inviteId, 'accepted').then(() => {
      console.log('Convite aceito com sucesso.');
      // Aqui você pode adicionar o usuário à lista de participantes da sala no Firestore
    }).catch(error => {
      console.error('Erro ao aceitar o convite:', error);
    });
  }

  declineInvite(inviteId: string | undefined) {
    if (!inviteId) {
      console.error('Erro: inviteId é undefined.')
      return;
    }
    this.inviteService.updateInviteStatus(inviteId, 'declined').then(() => {
      console.log('Convite recusado com sucesso.');
    }).catch(error => {
      console.error('Erro ao recusar o convite:', error);
    });
  }
}

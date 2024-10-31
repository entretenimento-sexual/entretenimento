// src\app\chat-module\invite-list\invite-list.component.ts
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
    const userId = 'ID_DO_USUÁRIO_ATUAL';
    this.inviteService.getInvites(userId).subscribe((invites: Invite[]) => {
      this.invites = invites;
      console.log('Convites carregados:', invites);
    });
  }

  acceptInvite(inviteId: string | undefined) {
    if (!inviteId) {
      console.error('Erro: inviteId é undefined.');
      return;
    }
    this.inviteService.updateInviteStatus(inviteId, 'accepted').then(() => {
      console.log('Convite aceito com sucesso.');
    }).catch(error => {
      console.error('Erro ao aceitar o convite:', error);
    });
  }

  declineInvite(inviteId: string | undefined) {
    if (!inviteId) {
      console.error('Erro: inviteId é undefined.');
      return;
    }
    this.inviteService.updateInviteStatus(inviteId, 'declined').then(() => {
      console.log('Convite recusado com sucesso.');
    }).catch(error => {
      console.error('Erro ao recusar o convite:', error);
    });
  }
}

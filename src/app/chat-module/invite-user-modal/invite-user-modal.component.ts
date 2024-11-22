// src/app/chat-module/invite-user-modal/invite-user-modal.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { InviteSearchService } from 'src/app/core/services/batepapo/invite-search.service';

@Component({
  selector: 'app-invite-user-modal',
  templateUrl: './invite-user-modal.component.html',
  styleUrls: ['./invite-user-modal.component.css'],
  standalone: false
})
export class InviteUserModalComponent implements OnInit {
  availableUsers: { id: string; nickname: string; selected: boolean }[] = [];
  searchTerm: string = '';

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { roomId: string },
    private inviteSearchService: InviteSearchService,
    private dialogRef: MatDialogRef<InviteUserModalComponent>
  ) { }

  ngOnInit(): void {
    this.loadEligibleUsers();
  }

  loadEligibleUsers(): void {
    // Certifique-se de que o operador é um dos valores aceitos
    const filters: { field: string; operator: '==' | '>=' | '<=' | 'array-contains'; value: any }[] = [
      { field: 'isOnline', operator: '==', value: true }
    ];

    this.inviteSearchService
      .searchEligibleUsers(this.data.roomId, filters, this.searchTerm, 'nickname', 20)
      .then((users) => {
        this.availableUsers = users.map((user) => ({
          id: user.uid,
          nickname: user.nickname || 'Sem apelido',
          selected: false
        }));
      })
      .catch((error) => {
        console.error('Erro ao buscar usuários elegíveis:', error);
      });
  }

  onSearchTermChange(): void {
    this.loadEligibleUsers();
  }

  confirmSelection(): void {
    const selectedUsers = this.availableUsers
      .filter((user) => user.selected)
      .map((user) => user.id);

    this.dialogRef.close(selectedUsers);
  }
}

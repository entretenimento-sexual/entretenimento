// src/app/chat-module/invite-user-modal/invite-user-modal.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from 'firebase/firestore';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, take } from 'rxjs/operators';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { InviteSearchService } from 'src/app/core/services/batepapo/invite-service/invite-search.service';
import { InviteService } from 'src/app/core/services/batepapo/invite-service/invite.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';

@Component({
  selector: 'app-invite-user-modal',
  templateUrl: './invite-user-modal.component.html',
  styleUrls: ['./invite-user-modal.component.css'],
  standalone: false
})
export class InviteUserModalComponent implements OnInit {
  availableUsers: { id: string; nickname: string; selected: boolean }[] = [];
  searchTerm: string = '';
  searchSubject: Subject<string> = new Subject<string>();
  isLoading: boolean = false;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { roomId: string; roomName: string },
    private inviteService: InviteService,
    private inviteSearchService: InviteSearchService,
    private userQuery: FirestoreUserQueryService,
    public dialogRef: MatDialogRef<InviteUserModalComponent>
  ) { }

  ngOnInit(): void {
    this.setupSearchListener();
    this.loadEligibleUsers();
  }

  setupSearchListener(): void {
    this.searchSubject
      .pipe(
        debounceTime(300), // Aguarda 300ms após a digitação
        distinctUntilChanged() // Evita buscas repetidas para o mesmo termo
      )
      .subscribe((term) => {
        this.searchTerm = term;
        this.loadEligibleUsers();
      });
  }

  onSearchTermChange(): void {
    this.searchSubject.next(this.searchTerm);
  }

  loadEligibleUsers(): void {
    this.isLoading = true;

    const filters: { field: string; operator: '==' | '>=' | '<=' | 'array-contains'; value: any }[] = [];
    console.log('Iniciando busca de usuários com os seguintes filtros:', filters, 'Termo de busca:', this.searchTerm);

    this.inviteSearchService.searchEligibleUsers(this.data.roomId, filters, this.searchTerm, 'nickname', 20)
      .then((users) => {
        console.log('Usuários encontrados:', users);
        this.availableUsers = users.map((user) => ({
          id: user.uid,
          nickname: user.nickname || 'Sem apelido',
          selected: false,
        }));
      })
      .catch((error) => {
        console.error('Erro ao buscar usuários elegíveis:', error);
      })
      .finally(() => {
        this.isLoading = false;
      });
  }

  confirmSelection(): void {
    const selectedUsers = this.availableUsers
      .filter((user) => user.selected)
      .map((user) => user.id);

    this.userQuery.getUser('currentUserUID').pipe( // Substituído para usar o serviço
      take(1)
    ).subscribe((currentUser) => {
      if (!currentUser) {
        console.error('Erro: Usuário não autenticado.');
        return;
      }

      selectedUsers.forEach((userId) => {
        const inviteData: Invite = {
          receiverId: userId,
          senderId: currentUser.uid, // Usando o UID do usuário autenticado
          status: 'pending',
          roomId: this.data.roomId,
          roomName: this.data.roomName, // Corrigido // Nome da sala vindo dinamicamente do @Inject
          sentAt: Timestamp.fromDate(new Date()),
          expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)), // Expira em 7 dias
        };

        this.inviteService
          .sendInviteToRoom(this.data.roomId, inviteData)
          .subscribe({
            next: () => console.log(`Convite enviado para o usuário: ${userId}`),
            error: (error) => console.error(`Erro ao enviar convite:`, error),
          });
      });

      this.dialogRef.close(selectedUsers);
    });
  }
}

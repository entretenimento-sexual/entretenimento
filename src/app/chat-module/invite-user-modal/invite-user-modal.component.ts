// src/app/chat-module/invite-user-modal/invite-user-modal.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
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
  searchSubject: Subject<string> = new Subject<string>();
  isLoading: boolean = false;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { roomId: string },
    private inviteSearchService: InviteSearchService,
    public dialogRef: MatDialogRef<InviteUserModalComponent>
  ) { }

  ngOnInit(): void {
    this.setupSearchListener();
    this.loadEligibleUsers(); // Carregar inicialmente
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

    this.dialogRef.close(selectedUsers);
  }
}

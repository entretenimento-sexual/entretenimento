// src/app/chat-module/invite-user-modal/invite-user-modal.component.ts
import { Component, OnInit, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, first } from 'rxjs/operators';
import { Timestamp, where } from 'firebase/firestore';
import { InviteSearchService } from 'src/app/core/services/batepapo/invite-service/invite-search.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { IBGELocationService } from 'src/app/core/services/general/api/ibge-location.service';
import { ValidGenders } from 'src/app/core/enums/valid-genders.enum';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { InviteService } from 'src/app/core/services/batepapo/invite-service/invite.service';
import { RegionFilterService } from 'src/app/core/services/filtering/filters/region-filter.service';

@Component({
  selector: 'app-invite-user-modal',
  templateUrl: './invite-user-modal.component.html',
  styleUrls: ['./invite-user-modal.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BaseModalComponent],
})
export class InviteUserModalComponent implements OnInit {
  availableUsers: { id: string; nickname: string; selected: boolean; photoURL?: string }[] = [];
  searchTerm: string = '';
  selectedGender?: string;
  selectedRegion: { uf?: string; city?: string } = {};
  availableStates: string[] = [];
  availableCities: string[] = [];
  availableGenders = Object.values(ValidGenders);
  isLoading: boolean = false;
  defaultAvatar = 'assets/images/default-avatar.png';
  private searchSubject: Subject<void> = new Subject<void>();

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { roomId: string; roomName: string },
    public dialogRef: MatDialogRef<InviteUserModalComponent>,
    private authService: AuthService,
    private ibgeLocationService: IBGELocationService,
    private inviteSearchService: InviteSearchService,
    private inviteService: InviteService,
    private regionFilter: RegionFilterService
  ) { }

  ngOnInit(): void {
    this.setupSearchListener();
    this.loadInitialData();
  }

  setupSearchListener(): void {
    this.searchSubject.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => this.loadUsers());
  }

  loadInitialData(): void {
    this.ibgeLocationService.getEstados().subscribe({
      next: (states: any[]) => {
        this.availableStates = states.map((state) => state.sigla);
      },
      error: (err: any) => console.error('Erro ao carregar estados:', err),
    });

    // Busca a região do usuário logado no Firestore
    // Busca a região do usuário logado no Firestore
    this.authService.getLoggedUserUID$().pipe(first()).subscribe({
      next: (uid) => {
        if (uid) {
          this.regionFilter.getUserRegion(uid).subscribe({
            next: (region) => {
              if (region) {
                this.selectedRegion = {
                  uf: region.uf,
                  city: region.city,
                };
                this.loadUsers(); // Carrega usuários após obter a região
                this.onRegionChange(); // Atualiza cidades com base na UF selecionada
              }
            },
            error: (err) => console.error('Erro ao buscar região do usuário no Firestore:', err),
          });
        } else {
          console.warn('UID não encontrado. Não foi possível carregar a região.');
        }
      },
      error: (err) => console.error('Erro ao obter UID do usuário:', err),
    });
  }

  isRegionFieldEditable(): boolean {
    const userRole = this.authService.currentUser?.role || 'visitante';
    // Permite edição apenas para papéis diferentes de 'visitante' e 'free'
    return !['visitante', 'free'].includes(userRole);
  }

  onRegionChange(): void {
    if (!this.selectedRegion.uf) {
      this.availableCities = [];
      return;
    }

    this.ibgeLocationService.getMunicipios(this.selectedRegion.uf).subscribe({
      next: (cities) => {
        this.availableCities = cities.map((city: any) => city.nome);
        if (!this.availableCities.includes(this.selectedRegion.city || '')) {
          this.selectedRegion.city = '';
        }
      },
      error: (err) => console.error('Erro ao carregar municípios:', err),
    });
  }

  onFilterChange(): void {
    this.searchSubject.next();
  }

  loadUsers(): void {
    this.isLoading = true;

    const filters = [];
    const currentUserId = this.authService.getLoggedUserUID$();

    if (this.selectedGender) {
      filters.push(where('gender', '==', this.selectedGender));
    }
    if (this.selectedRegion.uf) {
      filters.push(where('estado', '==', this.selectedRegion.uf));
    }
    if (this.selectedRegion.city) {
      filters.push(where('municipio', '==', this.selectedRegion.city));
    }
    if (this.searchTerm.trim()) {
      const searchTerm = this.searchTerm.trim().toLowerCase();
      filters.push(where('nicknameLowerCase', '>=', searchTerm));
      filters.push(where('nicknameLowerCase', '<=', searchTerm + '\uf8ff'));
    }
    if (currentUserId) {
      filters.push(where('uid', '!=', currentUserId)); // Exclui o próprio usuário
    }

    this.inviteSearchService.searchEligibleUsers(this.data.roomId, this.searchTerm, filters).subscribe({
      next: (users: any[]) => {
        this.availableUsers = users.map((user) => ({
          id: user.uid,
          nickname: user.nickname || 'Sem apelido',
          selected: false,
          photoURL: user.photoURL || this.defaultAvatar,
        }));
      },
      error: (err: any) => console.error('Erro ao buscar usuários:', err),
      complete: () => (this.isLoading = false),
    });
  }


  toggleUserSelection(user: { selected: boolean }): void {
    user.selected = !user.selected;
  }

  isAnyUserSelected(): boolean {
    return this.availableUsers.some((user) => user.selected);
  }

  confirmSelection(): void {
    this.authService.getLoggedUserUID$().pipe(first()).subscribe({
      next: (senderId) => {
        if (!senderId) {
          console.error('Erro: Usuário não autenticado.');
          return; // Finaliza o fluxo se o UID não estiver disponível
        }

        // Obtém os IDs dos usuários selecionados
        const selectedUserIds = this.availableUsers
          .filter((user) => user.selected)
          .map((user) => user.id);

        // Envia convites para cada usuário selecionado
        selectedUserIds.forEach((receiverId) => {
          this.inviteService.createInvite({
            roomId: this.data.roomId,
            roomName: this.data.roomName,
            receiverId,
            senderId, // Agora é uma string válida
            status: 'pending',
            sentAt: Timestamp.fromDate(new Date()),
            expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
          }).subscribe({
            next: () => console.log(`Convite enviado com sucesso para ${receiverId}.`),
            error: (err) => console.error('Erro ao enviar convite:', err),
          });
        });

        this.dialogRef.close(selectedUserIds); // Fecha o modal após envio
      },
      error: (err) => console.error('Erro ao obter UID do usuário:', err),
    });
  }
}

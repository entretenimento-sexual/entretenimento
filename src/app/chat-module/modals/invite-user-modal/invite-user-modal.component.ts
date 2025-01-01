// src/app/chat-module/invite-user-modal/invite-user-modal.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { InviteSearchService } from 'src/app/core/services/batepapo/invite-service/invite-search.service';
import { FilterEngineService } from 'src/app/core/services/filtering/filter-engine.service';
import { RegionFilterService } from 'src/app/core/services/filtering/filters/region-filter.service';
import { GenderFilterService } from 'src/app/core/services/filtering/filters/gender-filter.service';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Component({
  selector: 'app-invite-user-modal',
  templateUrl: './invite-user-modal.component.html',
  styleUrls: ['./invite-user-modal.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BaseModalComponent],
})
export class InviteUserModalComponent implements OnInit {
  availableUsers: { id: string; nickname: string; selected: boolean }[] = [];
  searchTerm: string = '';
  isLoading: boolean = false;
  selectedGender?: string;
  selectedRegion: { uf?: string; city?: string } = {};

  private searchSubject: Subject<void> = new Subject<void>();

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { roomId: string; roomName: string },
    private inviteSearchService: InviteSearchService,
    private filterEngine: FilterEngineService,
    private regionFilter: RegionFilterService,
    private genderFilter: GenderFilterService,
    public dialogRef: MatDialogRef<InviteUserModalComponent>
  ) { }

  ngOnInit(): void {
    this.setupSearchListener();
    this.loadEligibleUsers();
  }

  setupSearchListener(): void {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => {
        this.loadEligibleUsers();
      });
  }

  onFilterChange(): void {
    this.searchSubject.next();
  }

  loadEligibleUsers(): void {
    this.isLoading = true;
    this.filterEngine.clearConstraints();

    if (this.selectedGender) {
      const genderConstraints = this.genderFilter.applyFilter(this.selectedGender);
      genderConstraints.forEach((constraint) => this.filterEngine.addConstraint(constraint));
    }

    if (this.selectedRegion) {
      const { uf, city } = this.selectedRegion;
      const regionConstraints = this.regionFilter.applyFilter(uf, city);
      regionConstraints.forEach((constraint) => this.filterEngine.addConstraint(constraint));
    }

    this.inviteSearchService
      .searchEligibleUsers(this.data.roomId, this.searchTerm, this.filterEngine.getConstraints())
      .subscribe({
        next: (users: IUserDados[]) => {
          this.availableUsers = users.map((user) => ({
            id: user.uid,
            nickname: user.nickname || 'Sem apelido',
            selected: false,
          }));
        },
        error: (error: any) => console.error('Erro ao buscar usuários:', error),
        complete: () => {
          this.isLoading = false;
        },
      });
  }

  confirmSelection(): void {
    const selectedUsers = this.availableUsers
      .filter((user) => user.selected)
      .map((user) => user.id);

    console.log('Usuários selecionados:', selectedUsers);
    this.dialogRef.close(selectedUsers);
  }
}

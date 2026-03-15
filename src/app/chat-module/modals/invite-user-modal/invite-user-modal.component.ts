// src/app/chat-module/invite-user-modal/invite-user-modal.component.ts
// Modal para convidar usuários para uma sala.
//
// Ajustes desta versão:
// - usa AuthSessionService como fonte canônica do UID
// - usa CurrentUserStoreService como fonte do perfil/role
// - corrige filtro por uid (antes estava usando Observable dentro do where)
// - corrige listener de busca (Subject<void> + distinctUntilChanged travava novas buscas)
// - mantém nomes públicos do componente
// - centraliza tratamento de erro
import { Component, DestroyRef, Inject, OnInit, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { from, of, Subject } from 'rxjs';
import {
  catchError,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Timestamp, where, type QueryConstraint } from 'firebase/firestore';

import { InviteSearchService } from '../../../core/services/batepapo/invite-service/invite-search.service';
import { InviteService } from '../../../core/services/batepapo/invite-service/invite.service';
import { RegionFilterService } from '../../../core/services/filtering/filters/region-filter.service';
import { IBGELocationService } from '../../../core/services/general/api/ibge-location.service';

import { AuthSessionService } from '../../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../../core/services/autentication/auth/current-user-store.service';

import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';

import { ValidGenders } from '../../../core/enums/valid-genders.enum';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { IUserDados } from '../../../core/interfaces/iuser-dados';

@Component({
  selector: 'app-invite-user-modal',
  templateUrl: './invite-user-modal.component.html',
  styleUrls: ['./invite-user-modal.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BaseModalComponent],
})
export class InviteUserModalComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  availableUsers: { id: string; nickname: string; selected: boolean; photoURL?: string }[] = [];
  searchTerm = '';
  selectedGender?: string;
  selectedRegion: { uf?: string; city?: string } = {};
  availableStates: string[] = [];
  availableCities: string[] = [];
  availableGenders = Object.values(ValidGenders);
  isLoading = false;
  defaultAvatar = 'assets/images/default-avatar.png';

  private currentUserUid: string | null = null;
  private currentUserRole: IUserDados['role'] = 'visitante';
  private readonly searchSubject = new Subject<string>();

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { roomId: string; roomName: string },
    public dialogRef: MatDialogRef<InviteUserModalComponent>,
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly ibgeLocationService: IBGELocationService,
    private readonly inviteSearchService: InviteSearchService,
    private readonly inviteService: InviteService,
    private readonly regionFilter: RegionFilterService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
  ) {}

  ngOnInit(): void {
    this.observeSessionAndProfile();
    this.setupSearchListener();
    this.loadInitialData();
  }

  private observeSessionAndProfile(): void {
    this.authSession.uid$
      .pipe(
        map((uid: string | null) => (uid ?? '').trim() || null),
        distinctUntilChanged(),
        tap((uid) => {
          this.currentUserUid = uid;
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao observar sessão do usuário.',
            error,
            { op: 'observeSessionAndProfile.uid' },
            false
          );
          this.currentUserUid = null;
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.currentUserStore.user$
      .pipe(
        tap((user: IUserDados | null | undefined) => {
          this.currentUserRole = user?.role ?? 'visitante';
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao observar perfil do usuário.',
            error,
            { op: 'observeSessionAndProfile.user' },
            false
          );
          this.currentUserRole = 'visitante';
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  setupSearchListener(): void {
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => this.loadUsers()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  loadInitialData(): void {
    this.ibgeLocationService.getEstados()
      .pipe(
        tap((states: Array<{ sigla: string }>) => {
          this.availableStates = states.map((state) => state.sigla);
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao carregar estados.',
            error,
            { op: 'loadInitialData.getEstados' }
          );
          this.availableStates = [];
          return of([]);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.authSession.uid$
      .pipe(
        take(1),
        switchMap((uid: string | null) => {
          const authUid = (uid ?? '').trim();
          if (!authUid) {
            this.loadUsers();
            return of(null);
          }

          return this.regionFilter.getUserRegion(authUid).pipe(
            catchError((error) => {
              this.reportError(
                'Erro ao buscar região do usuário.',
                error,
                { op: 'loadInitialData.getUserRegion', uid: authUid },
                false
              );
              return of(null);
            })
          );
        }),
        tap((region: { uf?: string; city?: string } | null) => {
          if (region) {
            this.selectedRegion = {
              uf: region.uf,
              city: region.city,
            };

            this.onRegionChange();
          }

          this.loadUsers();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  isRegionFieldEditable(): boolean {
    return !['visitante', 'free'].includes(this.currentUserRole || 'visitante');
  }

  onRegionChange(): void {
    if (!this.selectedRegion.uf) {
      this.availableCities = [];
      return;
    }

    this.ibgeLocationService.getMunicipios(this.selectedRegion.uf)
      .pipe(
        tap((cities: Array<{ nome: string }>) => {
          this.availableCities = cities.map((city) => city.nome);

          if (!this.availableCities.includes(this.selectedRegion.city || '')) {
            this.selectedRegion.city = '';
          }
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao carregar municípios.',
            error,
            { op: 'onRegionChange', uf: this.selectedRegion.uf },
            false
          );
          this.availableCities = [];
          return of([]);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  onFilterChange(): void {
    this.searchSubject.next(this.buildSearchKey());
  }

  loadUsers(): void {
    this.isLoading = true;

    const filters: QueryConstraint[] = [];
    const currentUserId = this.currentUserUid;

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
      filters.push(where('uid', '!=', currentUserId));
    }

    this.inviteSearchService.searchEligibleUsers(this.data.roomId, this.searchTerm, filters)
      .pipe(
        tap((users: any[]) => {
          this.availableUsers = users.map((user) => ({
            id: user.uid,
            nickname: user.nickname || 'Sem apelido',
            selected: false,
            photoURL: user.photoURL || this.defaultAvatar,
          }));
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao buscar usuários elegíveis.',
            error,
            {
              op: 'loadUsers',
              roomId: this.data.roomId,
              selectedGender: this.selectedGender,
              selectedRegion: this.selectedRegion,
              searchTerm: this.searchTerm,
              currentUserId,
            }
          );
          this.availableUsers = [];
          return of([]);
        }),
        finalize(() => {
          this.isLoading = false;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  toggleUserSelection(user: { selected: boolean }): void {
    user.selected = !user.selected;
  }

  isAnyUserSelected(): boolean {
    return this.availableUsers.some((user) => user.selected);
  }

  confirmSelection(): void {
    const senderId = this.currentUserUid;

    if (!senderId) {
      this.errorNotifier.showError('Erro: usuário não autenticado.');
      return;
    }

    const selectedUserIds = this.availableUsers
      .filter((user) => user.selected)
      .map((user) => user.id);

    if (!selectedUserIds.length) {
      this.errorNotifier.showWarning('Selecione pelo menos um usuário para enviar convite.');
      return;
    }

    from(selectedUserIds)
      .pipe(
        concatMap((receiverId) =>
          this.inviteService.createInvite({
            roomId: this.data.roomId,
            roomName: this.data.roomName,
            receiverId,
            senderId,
            status: 'pending',
            sentAt: Timestamp.fromDate(new Date()),
            expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
          })
        ),
        catchError((error) => {
          this.reportError(
            'Erro ao enviar convite.',
            error,
            {
              op: 'confirmSelection',
              roomId: this.data.roomId,
              senderId,
              selectedUserIds,
            }
          );
          return of(null);
        }),
        finalize(() => {
          this.dialogRef.close(selectedUserIds);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private buildSearchKey(): string {
    return JSON.stringify({
      searchTerm: this.searchTerm.trim().toLowerCase(),
      selectedGender: this.selectedGender ?? null,
      uf: this.selectedRegion.uf ?? null,
      city: this.selectedRegion.city ?? null,
    });
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>,
    notifyUser = true
  ): void {
    if (notifyUser) {
      try {
        this.errorNotifier.showError(userMessage);
      } catch {}
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);
      (err as any).original = error;
      (err as any).context = {
        scope: 'InviteUserModalComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.globalError.handleError(err);
    } catch {}
  }
}// Linha 426

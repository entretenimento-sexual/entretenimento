// src/app/admin-dashboard/user-list/user-list.component.ts
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserManagementService } from 'src/app/core/services/account-moderation/user-management.service';
import { UserModerationService } from 'src/app/core/services/account-moderation/user-moderation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog/confirm-dialog.component';

type AdminUserFilter = 'pending' | 'restricted' | 'active' | 'all';
type UserStatusSeverity = 'success' | 'warning' | 'danger' | 'info';

interface IUserDadosExtended extends IUserDados {
  suspended: boolean;
  accountLocked: boolean;
  profileCompleted: boolean;
  actionPending: boolean;
  displayName: string;
  adminSubtitle: string;
  profileStatusLabel: string;
  operationalStatusLabel: string;
  statusSeverity: UserStatusSeverity;
  lastActivity: number;
  operationalPriority: number;
}

interface AdminUserFilterOption {
  value: AdminUserFilter;
  label: string;
  count: number;
}

@Component({
  selector: 'app-user-list',
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.css'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatChipsModule,
    MatProgressBarModule,
    MatCardModule,
    MatTooltipModule,
  ],
})
export class UserListComponent implements OnInit {
  displayedColumns = ['usuario', 'perfil', 'risco', 'acoes'];
  dataSource = new MatTableDataSource<IUserDadosExtended>([]);
  loading = false;
  activeFilter: AdminUserFilter = 'pending';
  searchTerm = '';

  private allUsers: IUserDadosExtended[] = [];
  private readonly pendingActionUids = new Set<string>();

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private readonly userManagementService: UserManagementService,
    private readonly userModeration: UserModerationService,
    private readonly notifications: ErrorNotificationService,
    private readonly dialog: MatDialog,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) { }

  get totalUsers(): number {
    return this.allUsers.length;
  }

  get pendingProfiles(): number {
    return this.allUsers.filter((user) => !user.profileCompleted).length;
  }

  get restrictedUsers(): number {
    return this.allUsers.filter((user) => this.isRestrictedUser(user)).length;
  }

  get activeUsers(): number {
    return this.allUsers.filter((user) => user.profileCompleted && !this.isRestrictedUser(user)).length;
  }

  get filterOptions(): AdminUserFilterOption[] {
    return [
      { value: 'pending', label: 'Cadastros pendentes', count: this.pendingProfiles },
      { value: 'restricted', label: 'Contas restritas', count: this.restrictedUsers },
      { value: 'active', label: 'Ativos', count: this.activeUsers },
      { value: 'all', label: 'Todos', count: this.totalUsers },
    ];
  }

  ngOnInit(): void {
    this.configureDataSource();
    this.loadUsers();
  }

  applyFilter(value: string): void {
    this.searchTerm = value;
    this.dataSource.filter = value.trim().toLowerCase();
  }

  setOperationalFilter(filter: AdminUserFilter): void {
    this.activeFilter = filter;
    this.renderRows();
  }

  loadUsers(): void {
    this.loading = true;
    this.cdr.markForCheck();

    this.userManagementService.getAllUsers()
      .pipe(finalize(() => {
        this.loading = false;
        this.cdr.markForCheck();
      }))
      .subscribe({
        next: (users) => {
          this.allUsers = users.map((user) => this.toAdminRow(user));
          this.renderRows();
        },
        error: (error) => this.notifications.showError(
          'Falha ao carregar usuários.',
          error instanceof Error ? error.message : undefined
        ),
      });
  }

  viewUserDetails(row: IUserDadosExtended): void {
    this.router.navigate(['/admin-dashboard/users', row.uid]);
  }

  toggleSuspend(row: IUserDadosExtended): void {
    const willSuspend = !row.suspended;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: willSuspend ? 'Suspender usuário' : 'Reativar usuário',
        message: willSuspend
          ? 'Confirmar suspensão deste usuário? O perfil deve sair da operação normal.'
          : 'Confirmar reativação deste usuário?',
      },
    });

    ref.afterClosed().subscribe((ok) => {
      if (!ok) {
        return;
      }

      const action$ = willSuspend
        ? this.userModeration.suspendUser(row.uid, 'Ação administrativa', '')
        : this.userModeration.unsuspendUser(row.uid, '');

      this.runUserAction(
        row,
        action$,
        willSuspend ? 'Usuário suspenso.' : 'Usuário reativado.',
        willSuspend ? 'Não foi possível suspender o usuário.' : 'Não foi possível reativar o usuário.',
        () => this.updateLocalUser(row.uid, {
          suspended: willSuspend,
          accountStatus: willSuspend ? 'moderation_suspended' : 'active',
          statusUpdatedAt: Date.now(),
        })
      );
    });
  }

  toggleLock(row: IUserDadosExtended): void {
    const willLock = !row.accountLocked;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: willLock ? 'Bloquear conta' : 'Desbloquear conta',
        message: willLock
          ? 'Confirmar bloqueio técnico desta conta? Use para risco operacional imediato.'
          : 'Confirmar desbloqueio desta conta?',
      },
    });

    ref.afterClosed().subscribe((ok) => {
      if (!ok) {
        return;
      }

      const action$ = willLock
        ? this.userModeration.lockAccount(row.uid)
        : this.userModeration.unlockAccount(row.uid);

      this.runUserAction(
        row,
        action$,
        willLock ? 'Conta bloqueada.' : 'Conta desbloqueada.',
        willLock ? 'Não foi possível bloquear a conta.' : 'Não foi possível desbloquear a conta.',
        () => this.updateLocalUser(row.uid, {
          accountLocked: willLock,
          statusUpdatedAt: Date.now(),
        })
      );
    });
  }

  deleteUser(row: IUserDadosExtended): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Excluir usuário',
        message: 'Esta ação remove o documento de usuário e pode exigir rotina administrativa separada para Auth. Confirmar exclusão?',
      },
    });

    ref.afterClosed().subscribe((ok) => {
      if (!ok) {
        return;
      }

      this.runUserAction(
        row,
        this.userManagementService.deleteUserAccount(row.uid),
        'Usuário excluído.',
        'Falha ao excluir usuário.',
        () => {
          this.allUsers = this.allUsers.filter((user) => user.uid !== row.uid);
          this.renderRows();
        }
      );
    });
  }

  trackByFilterValue(_: number, option: AdminUserFilterOption): string {
    return option.value;
  }

  private configureDataSource(): void {
    this.dataSource.filterPredicate = (row, filter) => [
      row.displayName,
      row.email,
      row.uid,
      row.municipio,
      row.estado,
      row.profileStatusLabel,
      row.operationalStatusLabel,
    ]
      .join(' ')
      .toLowerCase()
      .includes(filter);

    this.dataSource.sortingDataAccessor = (row, property) => {
      switch (property) {
        case 'usuario':
          return row.displayName.toLowerCase();
        case 'perfil':
          return row.profileCompleted ? 1 : 0;
        case 'risco':
          return row.operationalPriority;
        default:
          return String((row as any)[property] ?? '').toLowerCase();
      }
    };
  }

  private renderRows(): void {
    this.dataSource.data = this.applyOperationalFilter(this.allUsers)
      .map((user) => ({
        ...user,
        actionPending: this.pendingActionUids.has(user.uid),
      }));
    this.dataSource.filter = this.searchTerm.trim().toLowerCase();
    this.bindTableTools();
    this.cdr.markForCheck();
  }

  private bindTableTools(): void {
    Promise.resolve().then(() => {
      if (this.paginator) {
        this.dataSource.paginator = this.paginator;
      }

      if (this.sort) {
        this.dataSource.sort = this.sort;
      }
    });
  }

  private applyOperationalFilter(users: IUserDadosExtended[]): IUserDadosExtended[] {
    switch (this.activeFilter) {
      case 'pending':
        return users.filter((user) => !user.profileCompleted);
      case 'restricted':
        return users.filter((user) => this.isRestrictedUser(user));
      case 'active':
        return users.filter((user) => user.profileCompleted && !this.isRestrictedUser(user));
      case 'all':
      default:
        return users;
    }
  }

  private runUserAction(
    row: IUserDadosExtended,
    action$: Observable<void>,
    successMessage: string,
    errorMessage: string,
    afterSuccess: () => void
  ): void {
    const uid = String(row.uid ?? '').trim();

    if (!uid || this.pendingActionUids.has(uid)) {
      return;
    }

    this.setActionPending(uid, true);

    action$.pipe(
      finalize(() => this.setActionPending(uid, false))
    ).subscribe({
      next: () => {
        afterSuccess();
        this.notifications.showSuccess(successMessage);
      },
      error: (error) => this.notifications.showError(
        errorMessage,
        error instanceof Error ? error.message : undefined
      ),
    });
  }

  private setActionPending(uid: string, pending: boolean): void {
    if (pending) {
      this.pendingActionUids.add(uid);
    } else {
      this.pendingActionUids.delete(uid);
    }

    this.renderRows();
  }

  private updateLocalUser(uid: string, patch: Partial<IUserDados>): void {
    this.allUsers = this.allUsers.map((user) => user.uid === uid
      ? this.toAdminRow({ ...user, ...patch })
      : user
    );
    this.renderRows();
  }

  private toAdminRow(user: IUserDados): IUserDadosExtended {
    const uid = String(user.uid ?? '').trim();
    const suspended = user.suspended === true || user.accountStatus === 'moderation_suspended';
    const accountLocked = user.accountLocked === true;
    const profileCompleted = user.profileCompleted === true;
    const displayName = String(user.nickname || user.nome || user.email || 'Usuário sem identificação').trim();
    const region = [user.municipio, user.estado].filter(Boolean).join(' / ');
    const isSubscriber = user.isSubscriber === true || user.subscriptionStatus === 'active' || ['premium', 'vip'].includes(String(user.role ?? ''));
    const statusSeverity = this.userStatusSeverity({ ...user, suspended, accountLocked, profileCompleted });

    return {
      ...user,
      uid,
      suspended,
      accountLocked,
      profileCompleted,
      actionPending: this.pendingActionUids.has(uid),
      displayName,
      adminSubtitle: [region || 'Região não informada', isSubscriber ? 'Assinante' : 'Sem assinatura ativa'].join(' · '),
      profileStatusLabel: profileCompleted ? 'Perfil completo' : 'Cadastro pendente',
      operationalStatusLabel: this.userStatusLabel({ ...user, suspended, accountLocked, profileCompleted }),
      statusSeverity,
      lastActivity: this.userTime(user),
      operationalPriority: this.userOperationalPriority({ ...user, suspended, accountLocked, profileCompleted }),
    };
  }

  private userStatusLabel(user: Pick<IUserDadosExtended, 'suspended' | 'accountLocked' | 'accountStatus' | 'interactionBlocked' | 'profileCompleted'>): string {
    if (user.accountLocked) {
      return 'Conta bloqueada';
    }

    if (user.suspended || user.accountStatus === 'moderation_suspended') {
      return 'Suspenso';
    }

    if (user.interactionBlocked) {
      return 'Interação bloqueada';
    }

    if (user.accountStatus === 'pending_deletion') {
      return 'Exclusão pendente';
    }

    return 'Ativo';
  }

  private userStatusSeverity(user: Pick<IUserDadosExtended, 'suspended' | 'accountLocked' | 'accountStatus' | 'interactionBlocked' | 'profileCompleted'>): UserStatusSeverity {
    if (user.accountLocked || user.suspended || user.accountStatus === 'moderation_suspended' || user.accountStatus === 'pending_deletion') {
      return 'danger';
    }

    if (user.interactionBlocked || !user.profileCompleted) {
      return 'warning';
    }

    return 'success';
  }

  private userOperationalPriority(user: Pick<IUserDadosExtended, 'suspended' | 'accountLocked' | 'accountStatus' | 'interactionBlocked' | 'profileCompleted'>): number {
    if (user.accountLocked || user.suspended || user.accountStatus === 'moderation_suspended') {
      return 4;
    }

    if (user.accountStatus === 'pending_deletion' || user.interactionBlocked) {
      return 3;
    }

    if (!user.profileCompleted) {
      return 2;
    }

    return 1;
  }

  private isRestrictedUser(user: Pick<IUserDadosExtended, 'suspended' | 'accountLocked' | 'accountStatus' | 'interactionBlocked'>): boolean {
    return user.suspended === true
      || user.accountLocked === true
      || user.interactionBlocked === true
      || ['self_suspended', 'moderation_suspended', 'pending_deletion'].includes(String(user.accountStatus ?? ''));
  }

  private userTime(user: IUserDados): number {
    return Number(user.lastLogin ?? user.createdAt ?? user.registrationDate ?? user.firstLogin ?? 0) || 0;
  }
}

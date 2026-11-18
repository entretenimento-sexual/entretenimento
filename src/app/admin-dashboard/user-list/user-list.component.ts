// src/app/admin-dashboard/user-list/user-list.component.ts
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
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
import { finalize, map } from 'rxjs/operators';

import { type AdminUserRow } from 'src/app/core/services/account-moderation/admin-users-page.model';
import { AdminUsersPageService } from 'src/app/core/services/account-moderation/admin-users-page.service';
import { UserModerationService } from 'src/app/core/services/account-moderation/user-moderation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AccountLifecycleService, type AccountLifecycleCommandResult } from 'src/app/account/application/account-lifecycle.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog/confirm-dialog.component';

type AdminUserFilter = 'pending' | 'restricted' | 'active' | 'all';
type UserStatusSeverity = 'success' | 'warning' | 'danger' | 'info';

interface IUserDadosExtended extends AdminUserRow {
  suspended: boolean;
  accountLocked: boolean;
  profileCompleted: boolean;
  actionPending: boolean;
  displayName: string;
  adminSubtitle: string;
  profileStatusLabel: string;
  operationalStatusLabel: string;
  statusSeverity: UserStatusSeverity;
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
  loadFailed = false;
  hasMore = false;
  pageIndex = 0;

  private pageCursor: string | null = null;
  private nextCursor: string | null = null;
  private cursorHistory: Array<string | null> = [];

  private allUsers: IUserDadosExtended[] = [];
  private readonly pendingActionUids = new Set<string>();

  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private readonly adminUsersPage: AdminUsersPageService,
    private readonly userModeration: UserModerationService,
    private readonly accountLifecycle: AccountLifecycleService,
    private readonly notifications: ErrorNotificationService,
    private readonly dialog: MatDialog,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

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
    return this.allUsers.filter(
      (user) => user.profileCompleted && !this.isRestrictedUser(user)
    ).length;
  }

  get filterOptions(): AdminUserFilterOption[] {
    return [
      {
        value: 'pending',
        label: 'Cadastros pendentes',
        count: this.pendingProfiles,
      },
      {
        value: 'restricted',
        label: 'Contas restritas',
        count: this.restrictedUsers,
      },
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
    this.loadPage(this.pageCursor, 'refresh');
  }

  nextServerPage(): void {
    if (
      this.loading ||
      this.loadFailed ||
      !this.hasMore ||
      !this.nextCursor
    ) return;

    this.loadPage(this.nextCursor, 'next');
  }

  previousServerPage(): void {
    if (
      this.loading ||
      this.cursorHistory.length === 0
    ) return;

    const previous =
      this.cursorHistory[this.cursorHistory.length - 1];

    this.loadPage(previous, 'previous');
  }

  private loadPage(
    cursor: string | null,
    direction: 'refresh' | 'next' | 'previous'
  ): void {
    if (this.loading) return;

    this.loading = true;
    this.loadFailed = false;
    this.cdr.markForCheck();

    this.adminUsersPage.getAdminUsersPage$({
      cursor,
      limit: 25,
    }).pipe(
      finalize(() => {
        this.loading = false;
        this.cdr.markForCheck();
      })
    ).subscribe({
      next: page => {
        if (direction === 'next') {
          this.cursorHistory.push(this.pageCursor);
        } else if (direction === 'previous') {
          this.cursorHistory.pop();
        }

        this.pageCursor = cursor;
        this.pageIndex = this.cursorHistory.length;
        this.nextCursor = page.nextCursor;
        this.hasMore = page.hasMore;
        this.allUsers = page.items.map(
          user => this.toAdminRow(user)
        );

        this.renderRows();
      },
      error: () => {
        this.loadFailed = true;
        this.allUsers = [];
        this.renderRows();

        this.notifications.showError(
          'Falha ao carregar usuarios administrativos.'
        );
      },
    });
  }

  viewUserDetails(row: IUserDadosExtended): void {
    this.router.navigate(['/admin-dashboard/users', row.uid]);
  }

  toggleSuspend(row: IUserDadosExtended): void {
    if (row.accountStatus === 'self_suspended') {
      this.notifications.showInfo(
        'Esta conta foi suspensa pelo titular. A reativação deve ser feita por ele.'
      );
      return;
    }

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
      if (!ok) return;

      const action$ = willSuspend
        ? this.accountLifecycle.moderateSuspendAccount$(
            row.uid,
            'Medida de suspensão aplicada após decisão da moderação.'
          )
        : this.accountLifecycle.moderateUnsuspendAccount$(row.uid);

      this.runUserAction(
        row,
        action$,
        willSuspend ? 'Usuário suspenso.' : 'Usuário reativado.',
        (result) =>
          this.updateLocalUser(row.uid, {
            suspended: willSuspend,
            accountStatus: willSuspend ? 'moderation_suspended' : 'active',
            interactionBlocked: result.interactionBlocked ?? row.interactionBlocked,
            loginAllowed: result.loginAllowed ?? row.loginAllowed,
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
      if (!ok) return;

      const action$ = willLock
        ? this.userModeration.lockAccount(row.uid)
        : this.userModeration.unlockAccount(row.uid);

      this.runUserAction(
        row,
        action$.pipe(map(() => ({ ok: true }))),
        willLock ? 'Conta bloqueada.' : 'Conta desbloqueada.',
        () =>
          this.updateLocalUser(row.uid, {
            accountLocked: willLock,
          })
      );
    });
  }

  deleteUser(row: IUserDadosExtended): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Agendar exclusão',
        message:
          'A conta ficará invisível imediatamente e seguirá para a janela de retenção e expurgo do backend. Confirmar?',
        confirmText: 'Agendar exclusão',
      },
    });

    ref.afterClosed().subscribe((ok) => {
      if (!ok) return;

      this.runUserAction(
        row,
        this.accountLifecycle.moderateScheduleDeletion$(
          row.uid,
          'Exclusão agendada pela lista administrativa de usuários.'
        ),
        'Exclusão do usuário agendada.',
        () => {
          this.updateLocalUser(row.uid, {
            accountStatus: 'pending_deletion',
            interactionBlocked: true,
            loginAllowed: true,
            suspended: false,
          });
        }
      );
    });
  }

  trackByFilterValue(_: number, option: AdminUserFilterOption): string {
    return option.value;
  }

  private configureDataSource(): void {
    this.dataSource.filterPredicate = (row, filter) =>
      [
        row.displayName,
        row.uid,
        row.profileStatusLabel,
        row.operationalStatusLabel,
      ].join(' ').toLowerCase().includes(filter);

    this.dataSource.sortingDataAccessor = (row, property) => {
      switch (property) {
        case 'usuario':
          return row.displayName.toLowerCase();
        case 'perfil':
          return row.profileCompleted ? 1 : 0;
        case 'risco':
          return row.operationalPriority;
        default:
          return '';
      }
    };
  }

  private renderRows(): void {
    this.dataSource.data = this.applyOperationalFilter(this.allUsers).map(
      (user) => ({
        ...user,
        actionPending: this.pendingActionUids.has(user.uid),
      })
    );
    this.dataSource.filter = this.searchTerm.trim().toLowerCase();
    this.bindTableTools();
    this.cdr.markForCheck();
  }

  private bindTableTools(): void {
    Promise.resolve().then(() => {
      if (this.sort) {
        this.dataSource.sort = this.sort;
      }
    });
  }

  private applyOperationalFilter(
    users: IUserDadosExtended[]
  ): IUserDadosExtended[] {
    switch (this.activeFilter) {
      case 'pending':
        return users.filter((user) => !user.profileCompleted);
      case 'restricted':
        return users.filter((user) => this.isRestrictedUser(user));
      case 'active':
        return users.filter(
          (user) => user.profileCompleted && !this.isRestrictedUser(user)
        );
      case 'all':
      default:
        return users;
    }
  }

  private runUserAction(
    row: IUserDadosExtended,
    action$: Observable<AccountLifecycleCommandResult>,
    successMessage: string,
    afterSuccess: (result: AccountLifecycleCommandResult) => void
  ): void {
    const uid = String(row.uid ?? '').trim();

    if (!uid || this.pendingActionUids.has(uid)) return;

    this.setActionPending(uid, true);

    action$
      .pipe(finalize(() => this.setActionPending(uid, false)))
      .subscribe({
        next: (result) => {
          afterSuccess(result);
          this.notifications.showSuccess(result.message?.trim() || successMessage);
        },
        error: () => {
          // Os serviços da ação já apresentam o erro pela fronteira central.
        },
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

  private updateLocalUser(uid: string, patch: Partial<AdminUserRow>): void {
    this.allUsers = this.allUsers.map((user) =>
      user.uid === uid ? this.toAdminRow({ ...user, ...patch }) : user
    );
    this.renderRows();
  }

  private toAdminRow(user: AdminUserRow): IUserDadosExtended {
    const uid = user.uid;
    const suspended =
      user.suspended === true ||
      user.accountStatus === 'moderation_suspended';
    const accountLocked = user.accountLocked === true;
    const profileCompleted = user.profileCompleted === true;

    const operational = {
      ...user,
      suspended,
      accountLocked,
      profileCompleted,
    };

    return {
      ...operational,
      actionPending: this.pendingActionUids.has(uid),
      displayName: String(
        user.nickname || 'Usuario sem apelido'
      ).trim(),
      adminSubtitle: 'UID: ' + uid,
      profileStatusLabel: profileCompleted
        ? 'Perfil completo'
        : 'Cadastro pendente',
      operationalStatusLabel:
        this.userStatusLabel(operational),
      statusSeverity:
        this.userStatusSeverity(operational),
      operationalPriority:
        this.userOperationalPriority(operational),
    };
  }

  private userStatusLabel(
    user: Pick<
      IUserDadosExtended,
      | 'suspended'
      | 'accountLocked'
      | 'accountStatus'
      | 'interactionBlocked'
      | 'profileCompleted'
    >
  ): string {
    if (user.accountLocked) return 'Conta bloqueada';

    if (user.suspended || user.accountStatus === 'moderation_suspended') {
      return 'Suspenso';
    }

    if (user.accountStatus === 'pending_deletion') {
      return 'Exclusão pendente';
    }

    if (user.interactionBlocked) {
      return 'Interação bloqueada';
    }

    return 'Ativo';
  }

  private userStatusSeverity(
    user: Pick<
      IUserDadosExtended,
      | 'suspended'
      | 'accountLocked'
      | 'accountStatus'
      | 'interactionBlocked'
      | 'profileCompleted'
    >
  ): UserStatusSeverity {
    if (
      user.accountLocked ||
      user.suspended ||
      user.accountStatus === 'moderation_suspended' ||
      user.accountStatus === 'pending_deletion'
    ) {
      return 'danger';
    }

    if (user.interactionBlocked || !user.profileCompleted) {
      return 'warning';
    }

    return 'success';
  }

  private userOperationalPriority(
    user: Pick<
      IUserDadosExtended,
      | 'suspended'
      | 'accountLocked'
      | 'accountStatus'
      | 'interactionBlocked'
      | 'profileCompleted'
    >
  ): number {
    if (
      user.accountLocked ||
      user.suspended ||
      user.accountStatus === 'moderation_suspended'
    ) {
      return 4;
    }

    if (user.accountStatus === 'pending_deletion' || user.interactionBlocked) {
      return 3;
    }

    if (!user.profileCompleted) return 2;

    return 1;
  }

  private isRestrictedUser(
    user: Pick<
      IUserDadosExtended,
      'suspended' | 'accountLocked' | 'accountStatus' | 'interactionBlocked'
    >
  ): boolean {
    return (
      user.suspended === true ||
      user.accountLocked === true ||
      user.interactionBlocked === true ||
      ['self_suspended', 'moderation_suspended', 'pending_deletion'].includes(
        String(user.accountStatus ?? '')
      )
    );
  }

}

//src\app\admin-dashboard\user-list\user-list.component.ts
import { Component, OnInit, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { finalize } from 'rxjs/operators';


import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserManagementService } from 'src/app/core/services/account-moderation/user-management.service';
import { UserModerationService } from 'src/app/core/services/account-moderation/user-moderation.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog/confirm-dialog.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { MatChip } from "@angular/material/chips";
import { MatProgressBar } from "@angular/material/progress-bar";
import { MatCardTitle, MatCardHeader, MatCard } from "@angular/material/card";

interface IUserDadosExtended extends IUserDados { suspended: boolean; }

@Component({
  selector: 'app-user-list',
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.css'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatPaginatorModule, MatSortModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatMenuModule,
    MatChip,
    MatProgressBar,
    MatCardTitle,
    MatCardHeader,
    MatCard
]
})

export class UserListComponent implements OnInit {
  displayedColumns = ['nome', 'email', 'status', 'acoes'];
  dataSource = new MatTableDataSource<IUserDadosExtended>([]);
  loading = false;


  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
              private userManagementService: UserManagementService,
              private userModeration: UserModerationService,
              private snack: MatSnackBar,
              private dialog: MatDialog,
              private router: Router,
          ) { }

ngOnInit(): void { this.loadUsers(); }

applyFilter(value: string) {
  this.dataSource.filter = value.trim().toLowerCase();
}

loadUsers(): void {
  this.loading = true;
  this.userManagementService.getAllUsers()
    .pipe(finalize(() => (this.loading = false)))
    .subscribe({
      next: (users) => {
        const rows = users.map(u => ({ ...u, suspended: u.suspended ?? false }));
        this.dataSource.data = rows;
        // init após setar dados
        Promise.resolve().then(() => {
          if (this.paginator) this.dataSource.paginator = this.paginator;
          if (this.sort) this.dataSource.sort = this.sort;
        });
      },
      error: () => this.snack.open('Falha ao carregar usuários', 'Fechar', { duration: 3000 }),
    });
}

viewUserDetails(row: IUserDadosExtended): void {
  this.router.navigate(['./users', row.uid]);
}

toggleSuspend(row: IUserDadosExtended) {
  const willSuspend = !row.suspended;
  const ref = this.dialog.open(ConfirmDialogComponent, {
    data: {
      title: willSuspend ? 'Suspender usuário' : 'Reativar usuário',
      message: willSuspend ? 'Confirmar suspensão deste usuário?' : 'Confirmar reativação deste usuário?',
    },
  });
  ref.afterClosed().subscribe((ok) => {
    if (!ok) return;
    const op$ = willSuspend
      ? this.userModeration.suspendUser(row.uid, 'Ação administrativa', 'ADMIN_UID')
      : this.userModeration.unsuspendUser(row.uid, 'ADMIN_UID');

    op$.subscribe({
      next: () => {
        row.suspended = willSuspend;
        this.dataSource.data = [...this.dataSource.data];
        this.snack.open(willSuspend ? 'Usuário suspenso' : 'Usuário reativado', 'Fechar', { duration: 3000 });
      },
      error: () => this.snack.open('Ação falhou', 'Fechar', { duration: 3000 }),
    });
  });
}

deleteUser(row: IUserDadosExtended) {
  const ref = this.dialog.open(ConfirmDialogComponent, {
    data: { title: 'Excluir usuário', message: 'Esta ação é permanente. Confirmar exclusão?' },
  });
  ref.afterClosed().subscribe((ok) => {
    if (!ok) return;
    this.userManagementService.deleteUserAccount(row.uid).subscribe({
      next: () => {
        this.dataSource.data = this.dataSource.data.filter(u => u.uid !== row.uid);
        this.snack.open('Usuário excluído', 'Fechar', { duration: 3000 });
      },
      error: () => this.snack.open('Falha ao excluir usuário', 'Fechar', { duration: 3000 }),
    });
  });
}
}

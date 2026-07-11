// src/app/admin-dashboard/user-details/user-details.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { finalize } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserManagementService } from 'src/app/core/services/account-moderation/user-management.service';
import { UserModerationService } from 'src/app/core/services/account-moderation/user-moderation.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog/confirm-dialog.component';
import {
  MatCardTitle,
  MatCardSubtitle,
  MatCardContent,
  MatCardActions,
  MatCardHeader,
  MatCard,
} from '@angular/material/card';
import { MatChip } from '@angular/material/chips';
import { MatProgressBar } from '@angular/material/progress-bar';

@Component({
  selector: 'app-user-details',
  templateUrl: './user-details.component.html',
  styleUrl: './user-details.component.css',
  standalone: true,
  imports: [
    CommonModule,
    MatCardTitle,
    MatCardSubtitle,
    MatCardContent,
    MatChip,
    MatProgressBar,
    MatCardActions,
    MatCardHeader,
    MatCard,
  ],
})
export class UserDetailsComponent {
  user!: IUserDados & { suspended?: boolean };
  loading = false;

  constructor(
    route: ActivatedRoute,
    private readonly userMgmt: UserManagementService,
    private readonly moderation: UserModerationService,
    private readonly dialog: MatDialog,
    private readonly snack: MatSnackBar
  ) {
    this.user = route.snapshot.data['user'];
  }

  suspendUser(): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Suspender usuário',
        message: 'Confirmar suspensão deste usuário?',
      },
    });

    ref.afterClosed().subscribe((ok) => {
      if (!ok) return;

      this.loading = true;
      this.moderation
        .suspendUser(this.user.uid, 'Violação de regras', 'ADMIN_UID')
        .pipe(finalize(() => (this.loading = false)))
        .subscribe({
          next: () => {
            this.user = { ...this.user, suspended: true };
            this.snack.open('Usuário suspenso', 'Fechar', { duration: 3000 });
          },
          error: () =>
            this.snack.open('Falha ao suspender', 'Fechar', { duration: 3000 }),
        });
    });
  }

  unsuspendUser(): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Reativar usuário', message: 'Confirmar reativação?' },
    });

    ref.afterClosed().subscribe((ok) => {
      if (!ok) return;

      this.loading = true;
      this.moderation
        .unsuspendUser(this.user.uid, 'ADMIN_UID')
        .pipe(finalize(() => (this.loading = false)))
        .subscribe({
          next: () => {
            this.user = { ...this.user, suspended: false };
            this.snack.open('Usuário reativado', 'Fechar', { duration: 3000 });
          },
          error: () =>
            this.snack.open('Falha ao reativar', 'Fechar', { duration: 3000 }),
        });
    });
  }

  deleteUser(): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Agendar exclusão',
        message:
          'A conta ficará invisível imediatamente e seguirá para a janela de retenção e expurgo do backend. Deseja prosseguir?',
        confirmText: 'Agendar exclusão',
      },
    });

    ref.afterClosed().subscribe((ok) => {
      if (!ok) return;

      this.loading = true;
      this.userMgmt
        .deleteUserAccount(
          this.user.uid,
          'Exclusão agendada pela tela administrativa de detalhes.'
        )
        .pipe(finalize(() => (this.loading = false)))
        .subscribe({
          next: () => {
            const now = Date.now();

            this.user = {
              ...this.user,
              accountStatus: 'pending_deletion',
              publicVisibility: 'hidden',
              interactionBlocked: true,
              loginAllowed: true,
              suspended: false,
              deletionRequestedAt: now,
              deletionRequestedBy: 'moderator',
              statusUpdatedAt: now,
            };

            this.snack.open('Exclusão agendada', 'Fechar', { duration: 3000 });
          },
          error: () =>
            this.snack.open('Falha ao agendar exclusão', 'Fechar', {
              duration: 3000,
            }),
        });
    });
  }
}

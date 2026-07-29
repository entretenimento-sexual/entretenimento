// src/app/admin-dashboard/user-details/user-details.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EMPTY } from 'rxjs';
import { finalize, switchMap } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AccountLifecycleService } from 'src/app/account/application/account-lifecycle.service';
import { StaffComplianceService } from 'src/app/core/services/compliance/staff-compliance.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog/confirm-dialog.component';
import {
  ComplianceNoticeDialogComponent,
} from './compliance-notice-dialog.component';
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
import { MatButtonModule } from '@angular/material/button';

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
    MatButtonModule,
  ],
})
export class UserDetailsComponent {
  user!: IUserDados & { suspended?: boolean };
  loading = false;

  constructor(
    route: ActivatedRoute,
    private readonly accountLifecycle: AccountLifecycleService,
    private readonly staffCompliance: StaffComplianceService,
    private readonly dialog: MatDialog,
    private readonly snack: MatSnackBar
  ) {
    this.user = route.snapshot.data['user'];
  }

  issueComplianceNotice(): void {
    if (this.loading) return;

    const ref = this.dialog.open(ComplianceNoticeDialogComponent, {
      width: 'min(94vw, 640px)',
      maxWidth: '94vw',
      data: {
        targetUid: this.user.uid,
        targetLabel:
          String(this.user.nickname ?? this.user.nome ?? '').trim() ||
          this.user.email ||
          this.user.uid,
      },
    });

    ref.afterClosed()
      .pipe(
        switchMap((payload) => {
          if (!payload) return EMPTY;
          this.loading = true;
          return this.staffCompliance.issueSuspectedViolationNotice$(payload);
        }),
        finalize(() => {
          this.loading = false;
        })
      )
      .subscribe({
        next: (result) => {
          this.snack.open(
            `Aviso emitido. Caso ${result.caseId}`,
            'Fechar',
            { duration: 5000 }
          );
        },
        error: () => {
          // StaffComplianceService centraliza diagnóstico e feedback.
        },
      });
  }

  suspendUser(): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Suspender usuário',
        message:
          'Confirme somente após registrar os fatos e a regra aplicável. A suspensão será auditada e notificada ao usuário.',
      },
    });

    ref.afterClosed().subscribe((ok) => {
      if (!ok) return;

      this.loading = true;
      this.accountLifecycle
        .moderateSuspendAccount$(
          this.user.uid,
          'Medida de suspensão aplicada após decisão da moderação.'
        )
        .pipe(finalize(() => (this.loading = false)))
        .subscribe({
          next: () => {
            this.user = {
              ...this.user,
              suspended: true,
              accountStatus: 'moderation_suspended',
              publicVisibility: 'hidden',
              interactionBlocked: true,
            };
            this.snack.open('Usuário suspenso e notificado', 'Fechar', {
              duration: 3000,
            });
          },
          error: () => {
            // AccountLifecycleService centraliza diagnóstico e feedback.
          },
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
      this.accountLifecycle
        .moderateUnsuspendAccount$(this.user.uid)
        .pipe(finalize(() => (this.loading = false)))
        .subscribe({
          next: () => {
            this.user = {
              ...this.user,
              suspended: false,
              accountStatus: 'active',
              interactionBlocked: false,
            };
            this.snack.open('Usuário reativado', 'Fechar', { duration: 3000 });
          },
          error: () => {
            // AccountLifecycleService centraliza diagnóstico e feedback.
          },
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
      this.accountLifecycle
        .moderateScheduleDeletion$(
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

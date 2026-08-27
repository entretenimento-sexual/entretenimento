// src/app/account/pages/account-manage/account-manage.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { finalize, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccountLifecycleService } from '../../application/account-lifecycle.service';
import { AccountReauthenticationService } from '../../application/account-reauthentication.service';
import {
  AccountLifecycleDialogConfirmEvent,
  AccountLifecycleDialogIntent,
  AccountReauthenticationMode,
} from '../../models/account-lifecycle.model';
import { AccountLifecycleDialogComponent } from '../../components/account-lifecycle-dialog/account-lifecycle-dialog.component';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-account-manage',
  standalone: true,
  imports: [AccountLifecycleDialogComponent],
  templateUrl: './account-manage.component.html',
  styleUrl: '../account-section.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountManageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly accountLifecycleService = inject(AccountLifecycleService);
  private readonly accountReauthentication = inject(AccountReauthenticationService);
  private readonly notify = inject(ErrorNotificationService);

  readonly lifecycleDialogIntent = signal<AccountLifecycleDialogIntent | null>(null);
  readonly lifecycleBusyIntent = signal<AccountLifecycleDialogIntent | null>(null);
  readonly lifecycleReauthenticationMode = signal<AccountReauthenticationMode>('unsupported');

  readonly isLifecycleBusy = computed(() => this.lifecycleBusyIntent() !== null);

  openSelfSuspendDialog(): void {
    if (this.isLifecycleBusy()) return;
    this.openLifecycleDialog('self_suspend');
  }

  openSelfDeleteDialog(): void {
    if (this.isLifecycleBusy()) return;
    this.openLifecycleDialog('self_delete');
  }

  closeLifecycleDialog(): void {
    if (this.isLifecycleBusy()) return;
    this.lifecycleDialogIntent.set(null);
  }

  onLifecycleDialogConfirmed(event: AccountLifecycleDialogConfirmEvent): void {
    switch (event.intent) {
      case 'self_suspend':
        this.executeSelfSuspension(event.reason, event.password);
        return;
      case 'self_delete':
        this.executeSelfDeletion(event.reason, event.password);
        return;
      default:
        this.lifecycleDialogIntent.set(null);
    }
  }

  private openLifecycleDialog(intent: AccountLifecycleDialogIntent): void {
    this.lifecycleReauthenticationMode.set(
      this.accountReauthentication.getCurrentMode()
    );
    this.lifecycleDialogIntent.set(intent);
  }

  private executeSelfSuspension(
    reason?: string | null,
    password?: string | null
  ): void {
    if (this.isLifecycleBusy()) return;

    this.lifecycleBusyIntent.set('self_suspend');

    this.accountReauthentication
      .reauthenticateForSensitiveAction$(password)
      .pipe(
        switchMap(() => this.accountLifecycleService.requestSelfSuspension$(reason)),
        finalize(() => this.lifecycleBusyIntent.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          this.currentUserStore.patch({
            accountStatus: 'self_suspended',
            publicVisibility: 'hidden',
            interactionBlocked: true,
            loginAllowed: true,
            suspended: true,
            suspensionReason: (reason ?? '').trim() || null,
            suspensionSource: 'self',
            suspensionEndsAt: null,
            statusUpdatedAt: this.normalizeEpoch(result.statusUpdatedAt) ?? Date.now(),
            statusUpdatedBy: 'self',
          });

          this.lifecycleDialogIntent.set(null);
          this.notify.showSuccess(result.message ?? 'Conta suspensa com sucesso.');
          this.router.navigate(['/conta/status'], { replaceUrl: true });
        },
        error: () => {
          // Reautenticação e lifecycle centralizam diagnóstico e feedback.
        },
      });
  }

  private executeSelfDeletion(
    reason?: string | null,
    password?: string | null
  ): void {
    if (this.isLifecycleBusy()) return;

    this.lifecycleBusyIntent.set('self_delete');

    this.accountReauthentication
      .reauthenticateForSensitiveAction$(password)
      .pipe(
        switchMap(() => this.accountLifecycleService.requestAccountDeletion$(reason)),
        finalize(() => this.lifecycleBusyIntent.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          const statusUpdatedAt = this.normalizeEpoch(result.statusUpdatedAt) ?? Date.now();

          this.currentUserStore.patch({
            accountStatus: 'pending_deletion',
            publicVisibility: 'hidden',
            interactionBlocked: true,
            loginAllowed: true,
            suspended: false,
            suspensionReason: null,
            suspensionSource: null,
            suspensionEndsAt: null,
            deletionRequestedAt: this.normalizeEpoch(result.deletionRequestedAt) ?? statusUpdatedAt,
            deletionRequestedBy: 'self',
            deletionUndoUntil: this.normalizeEpoch(result.deletionUndoUntil),
            purgeAfter: this.normalizeEpoch(result.purgeAfter),
            statusUpdatedAt,
            statusUpdatedBy: 'self',
          });

          this.lifecycleDialogIntent.set(null);
          this.notify.showSuccess(result.message ?? 'Exclusão da conta iniciada.');
          this.router.navigate(['/conta/status'], { replaceUrl: true });
        },
        error: () => {
          // Reautenticação e lifecycle centralizam diagnóstico e feedback.
        },
      });
  }

  private normalizeEpoch(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }
}

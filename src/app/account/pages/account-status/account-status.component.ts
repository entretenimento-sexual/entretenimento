// src/app/account/pages/account-status/account-status.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { finalize, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccountLifecycleFacade } from '../../application/account-lifecycle.facade';
import { AccountLifecycleService } from '../../application/account-lifecycle.service';
import { AccountReauthenticationService } from '../../application/account-reauthentication.service';
import {
  AccountLifecycleDialogConfirmEvent,
  AccountLifecycleDialogIntent,
  AccountReauthenticationMode,
  AccountStatus,
} from '../../models/account-lifecycle.model';
import { AccountLifecycleDialogComponent } from '../../components/account-lifecycle-dialog/account-lifecycle-dialog.component';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-account-status',
  standalone: true,
  imports: [CommonModule, RouterModule, AccountLifecycleDialogComponent],
  templateUrl: './account-status.component.html',
  styleUrl: './account-status.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountStatusComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly accountLifecycleFacade = inject(AccountLifecycleFacade);
  private readonly accountLifecycleService = inject(AccountLifecycleService);
  private readonly accountReauthentication = inject(
    AccountReauthenticationService
  );
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly notify = inject(ErrorNotificationService);

  readonly lifecycleState$ = this.accountLifecycleFacade.lifecycleState$;
  readonly vm$ = this.accountLifecycleFacade.statusVm$;

  readonly busyAction = signal<'reactivate' | 'cancel_deletion' | null>(null);
  readonly lifecycleDialogIntent =
    signal<AccountLifecycleDialogIntent | null>(null);
  readonly lifecycleReauthenticationMode =
    signal<AccountReauthenticationMode>('unsupported');

  readonly isReactivating = computed(
    () => this.busyAction() === 'reactivate'
  );
  readonly isCancelingDeletion = computed(
    () => this.busyAction() === 'cancel_deletion'
  );
  readonly isBusy = computed(() => this.busyAction() !== null);

  onReactivateSelfSuspension(): void {
    if (this.isBusy()) return;
    this.openLifecycleDialog('reactivate_self_suspend');
  }

  onCancelDeletion(): void {
    if (this.isBusy()) return;
    this.openLifecycleDialog('cancel_pending_deletion');
  }

  closeLifecycleDialog(): void {
    if (this.isBusy()) return;
    this.lifecycleDialogIntent.set(null);
  }

  onLifecycleDialogConfirmed(
    event: AccountLifecycleDialogConfirmEvent
  ): void {
    switch (event.intent) {
      case 'reactivate_self_suspend':
        this.executeReactivateSelfSuspension(event.password);
        return;

      case 'cancel_pending_deletion':
        this.executeCancelDeletion(event.password);
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

  private executeReactivateSelfSuspension(password?: string | null): void {
    if (this.isBusy()) return;

    this.busyAction.set('reactivate');

    this.accountReauthentication
      .reauthenticateForSensitiveAction$(password)
      .pipe(
        switchMap(() =>
          this.accountLifecycleService.reactivateSelfSuspension$()
        ),
        finalize(() => this.busyAction.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          const publicVisibility =
            result.publicVisibility === 'visible' ? 'visible' : 'hidden';
          const interactionBlocked =
            typeof result.interactionBlocked === 'boolean'
              ? result.interactionBlocked
              : publicVisibility !== 'visible';

          this.currentUserStore.patch({
            accountStatus: 'active',
            publicVisibility,
            interactionBlocked,
            loginAllowed: true,
            suspended: false,
            suspensionReason: null,
            suspensionSource: null,
            suspensionEndsAt: null,
            statusUpdatedAt:
              this.normalizeEpoch(result.statusUpdatedAt) ?? Date.now(),
            statusUpdatedBy: 'self',
          });

          this.lifecycleDialogIntent.set(null);
          this.notify.showSuccess(
            result.message ?? 'Conta reativada com sucesso.'
          );
          this.router.navigate(['/conta'], { replaceUrl: true });
        },
        error: () => {
          // Reautenticação e lifecycle centralizam diagnóstico e feedback.
        },
      });
  }

  private executeCancelDeletion(password?: string | null): void {
    if (this.isBusy()) return;

    this.busyAction.set('cancel_deletion');

    this.accountReauthentication
      .reauthenticateForSensitiveAction$(password)
      .pipe(
        switchMap(() =>
          this.accountLifecycleService.cancelAccountDeletion$()
        ),
        finalize(() => this.busyAction.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          const accountStatus = this.normalizeAccountStatus(
            result.accountStatus
          );
          const publicVisibility =
            result.publicVisibility === 'visible' ? 'visible' : 'hidden';
          const interactionBlocked =
            typeof result.interactionBlocked === 'boolean'
              ? result.interactionBlocked
              : accountStatus !== 'active' || publicVisibility !== 'visible';
          const restricted =
            accountStatus !== 'active' || interactionBlocked;

          this.currentUserStore.patch({
            accountStatus,
            publicVisibility,
            interactionBlocked,
            loginAllowed: true,
            suspended: result.suspended ?? accountStatus !== 'active',
            suspensionReason: restricted
              ? result.suspensionReason ?? null
              : null,
            suspensionSource: restricted
              ? result.suspensionSource ??
                (accountStatus === 'self_suspended'
                  ? 'self'
                  : accountStatus === 'moderation_suspended'
                    ? 'moderator'
                    : null)
              : null,
            suspensionEndsAt: restricted
              ? this.normalizeEpoch(result.suspensionEndsAt)
              : null,
            deletionRequestedAt: null,
            deletionRequestedBy: null,
            deletionUndoUntil: null,
            purgeAfter: null,
            statusUpdatedAt:
              this.normalizeEpoch(result.statusUpdatedAt) ?? Date.now(),
            statusUpdatedBy: 'self',
          });

          this.lifecycleDialogIntent.set(null);
          this.notify.showSuccess(
            result.message ?? 'Exclusão cancelada com sucesso.'
          );

          if (accountStatus === 'active') {
            this.router.navigate(['/conta'], { replaceUrl: true });
          }
        },
        error: () => {
          // Reautenticação e lifecycle centralizam diagnóstico e feedback.
        },
      });
  }

  private normalizeAccountStatus(value: unknown): AccountStatus {
    return value === 'self_suspended' || value === 'moderation_suspended'
      ? value
      : 'active';
  }

  private normalizeEpoch(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.trunc(parsed)
      : null;
  }
}

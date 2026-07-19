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
import { finalize } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccountLifecycleFacade } from '../../application/account-lifecycle.facade';
import { AccountLifecycleService } from '../../application/account-lifecycle.service';
import {
  AccountStatus,
} from '../../models/account-lifecycle.model';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-account-status',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './account-status.component.html',
  styleUrl: './account-status.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountStatusComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly accountLifecycleFacade = inject(AccountLifecycleFacade);
  private readonly accountLifecycleService = inject(AccountLifecycleService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly notify = inject(ErrorNotificationService);

  readonly lifecycleState$ = this.accountLifecycleFacade.lifecycleState$;
  readonly vm$ = this.accountLifecycleFacade.statusVm$;

  readonly busyAction = signal<'reactivate' | 'cancel_deletion' | null>(null);

  readonly isReactivating = computed(
    () => this.busyAction() === 'reactivate'
  );
  readonly isCancelingDeletion = computed(
    () => this.busyAction() === 'cancel_deletion'
  );
  readonly isBusy = computed(() => this.busyAction() !== null);

  onReactivateSelfSuspension(): void {
    if (this.isBusy()) return;

    this.busyAction.set('reactivate');

    this.accountLifecycleService
      .reactivateSelfSuspension$()
      .pipe(
        finalize(() => this.busyAction.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          this.currentUserStore.patch({
            accountStatus: 'active',
            publicVisibility: 'visible',
            interactionBlocked: false,
            loginAllowed: true,
            suspended: false,
            suspensionReason: null,
            suspensionSource: null,
            suspensionEndsAt: null,
            statusUpdatedAt:
              this.normalizeEpoch(result.statusUpdatedAt) ?? Date.now(),
            statusUpdatedBy: 'self',
          });

          this.notify.showSuccess(
            result.message ?? 'Conta reativada com sucesso.'
          );
          this.router.navigate(['/conta'], { replaceUrl: true });
        },
        error: () => {
          // O feedback de erro já é tratado pelo AccountLifecycleService.
        },
      });
  }

  onCancelDeletion(): void {
    if (this.isBusy()) return;

    this.busyAction.set('cancel_deletion');

    this.accountLifecycleService
      .cancelAccountDeletion$()
      .pipe(
        finalize(() => this.busyAction.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          const accountStatus = this.normalizeAccountStatus(
            result.accountStatus
          );
          const restricted = accountStatus !== 'active';

          this.currentUserStore.patch({
            accountStatus,
            publicVisibility: restricted ? 'hidden' : 'visible',
            interactionBlocked: restricted,
            loginAllowed: true,
            suspended: result.suspended ?? restricted,
            suspensionReason: restricted
              ? result.suspensionReason ?? null
              : null,
            suspensionSource: restricted
              ? result.suspensionSource ??
                (accountStatus === 'self_suspended'
                  ? 'self'
                  : 'moderator')
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

          this.notify.showSuccess(
            result.message ?? 'Exclusão cancelada com sucesso.'
          );

          if (accountStatus === 'active') {
            this.router.navigate(['/conta'], { replaceUrl: true });
          }
        },
        error: () => {
          // O feedback de erro já é tratado pelo AccountLifecycleService.
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

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
import { Observable, of } from 'rxjs';
import {
  filter,
  finalize,
  map,
  switchMap,
  take,
  timeout,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccountLifecycleFacade } from '../../application/account-lifecycle.facade';
import { AccountLifecycleService } from '../../application/account-lifecycle.service';
import { AccountReauthenticationService } from '../../application/account-reauthentication.service';
import {
  AccountLifecycleDialogConfirmEvent,
  AccountLifecycleDialogIntent,
  AccountReauthenticationMode,
} from '../../models/account-lifecycle.model';
import { AccountLifecycleDialogComponent } from '../../components/account-lifecycle-dialog/account-lifecycle-dialog.component';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import {
  normalizeUserAccountLifecycleStatus,
  type RuntimeAccountLifecycleStatus,
} from '@core/services/autentication/auth/account-lifecycle.policy';
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
        switchMap((result) =>
          this.waitForLifecycleChange$('self_suspended').pipe(
            map((accountStatus) => ({ result, accountStatus }))
          )
        ),
        finalize(() => this.busyAction.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ result, accountStatus }) => {
          this.lifecycleDialogIntent.set(null);
          this.notify.showSuccess(
            result.message ?? 'Conta reativada com sucesso.'
          );

          if (accountStatus === 'active') {
            this.router.navigate(['/conta'], { replaceUrl: true });
            return;
          }

          if (accountStatus === null) {
            this.notify.showInfo(
              'A alteração foi salva, mas a atualização do estado da conta ainda está em andamento.'
            );
          }
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
        switchMap((result) =>
          this.waitForLifecycleChange$('pending_deletion').pipe(
            map((accountStatus) => ({ result, accountStatus }))
          )
        ),
        finalize(() => this.busyAction.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ result, accountStatus }) => {
          this.lifecycleDialogIntent.set(null);
          this.notify.showSuccess(
            result.message ?? 'Exclusão cancelada com sucesso.'
          );

          if (accountStatus === 'active') {
            this.router.navigate(['/conta'], { replaceUrl: true });
            return;
          }

          if (accountStatus === null) {
            this.notify.showInfo(
              'A alteração foi salva, mas a atualização do estado da conta ainda está em andamento.'
            );
          }
        },
        error: () => {
          // Reautenticação e lifecycle centralizam diagnóstico e feedback.
        },
      });
  }

  /**
   * O backend é a autoridade do lifecycle. Depois da callable, aguardamos a
   * hidratação oficial Firestore -> Store em vez de fabricar um estado local por
   * `CurrentUserStoreService.patch()`.
   */
  private waitForLifecycleChange$(
    previousStatus: RuntimeAccountLifecycleStatus
  ): Observable<RuntimeAccountLifecycleStatus | null> {
    return this.currentUserStore.user$.pipe(
      map((user) => normalizeUserAccountLifecycleStatus(user)),
      filter(
        (status) => status !== 'unknown' && status !== previousStatus
      ),
      take(1),
      timeout({
        first: 5_000,
        with: () => of(null),
      })
    );
  }
}

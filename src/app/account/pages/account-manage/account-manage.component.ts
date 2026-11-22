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
import { finalize } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccountLifecycleService } from '../../application/account-lifecycle.service';
import {
  AccountReauthenticationService,
  isAccountActionSessionChanged,
  type AccountActionSession,
} from '../../application/account-reauthentication.service';
import {
  AccountLifecycleDialogConfirmEvent,
  AccountLifecycleDialogIntent,
  AccountReauthenticationMode,
} from '../../models/account-lifecycle.model';
import { AccountLifecycleDialogComponent } from '../../components/account-lifecycle-dialog/account-lifecycle-dialog.component';
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
  private readonly accountLifecycleService = inject(AccountLifecycleService);
  private readonly accountReauthentication = inject(AccountReauthenticationService);
  private readonly notify = inject(ErrorNotificationService);
  private dialogSession: AccountActionSession | null = null;

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
    this.dialogSession = this.accountReauthentication.captureSensitiveActionSession();
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
      .runSensitiveAction$(this.dialogSession, password, (uid) =>
        this.accountLifecycleService.requestSelfSuspension$(uid, reason)
      )
      .pipe(
        finalize(() => this.lifecycleBusyIntent.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          this.lifecycleDialogIntent.set(null);
          this.notify.showSuccess(result.message ?? 'Conta suspensa com sucesso.');
          this.router.navigate(['/conta/status'], { replaceUrl: true });
        },
        error: (error: unknown) => {
          if (isAccountActionSessionChanged(error)) this.lifecycleDialogIntent.set(null);
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
      .runSensitiveAction$(this.dialogSession, password, (uid) =>
        this.accountLifecycleService.requestAccountDeletion$(uid, reason)
      )
      .pipe(
        finalize(() => this.lifecycleBusyIntent.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          this.lifecycleDialogIntent.set(null);
          this.notify.showSuccess(result.message ?? 'Exclusão da conta iniciada.');
          this.router.navigate(['/conta/status'], { replaceUrl: true });
        },
        error: (error: unknown) => {
          if (isAccountActionSessionChanged(error)) this.lifecycleDialogIntent.set(null);
        },
      });
  }
}

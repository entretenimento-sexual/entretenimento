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
import { EMPTY, Observable, combineLatest, of } from 'rxjs';
import {
  filter,
  finalize,
  map,
  switchMap,
  take,
  timeout,
} from 'rxjs/operators';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { AccountLifecycleFacade } from '../../application/account-lifecycle.facade';
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
import { AuthAppBlockService } from '@core/services/autentication/auth/auth-app-block.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { LogoutService } from '@core/services/autentication/auth/logout.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import {
  normalizeUserAccountLifecycleStatus,
  type RuntimeAccountLifecycleStatus,
} from '@core/services/autentication/auth/account-lifecycle.policy';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { PageHeaderComponent } from '../../../shared/page-header/page-header.component';
import { ContentStateComponent } from '../../../shared/content-state/content-state.component';

@Component({
  selector: 'app-account-status',
  standalone: true,
  imports: [CommonModule, RouterModule, AccountLifecycleDialogComponent, PageHeaderComponent, ContentStateComponent],
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
  private readonly dialogSession = signal<AccountActionSession | null>(null);

  private readonly authSession = inject(AuthSessionService);
  private readonly appBlock = inject(AuthAppBlockService);
  private readonly logoutService = inject(LogoutService);
  readonly domainBlock$ = combineLatest([this.authSession.uid$, this.appBlock.reason$]).pipe(
    map(([uid]) => this.appBlock.domainBlockFor(uid))
  );

  logout(): void {
    this.logoutService.logout();
  }

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

  constructor() {
    toObservable(this.dialogSession).pipe(
      switchMap((session) => session
        ? this.accountReauthentication.sensitiveActionSessionChanged$(session).pipe(map(() => session))
        : EMPTY),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((session) => {
      if (this.dialogSession() !== session || this.isBusy()) return;
      this.dismissLifecycleDialog();
      this.notify.showInfo('A confirmação foi fechada porque a conta ativa mudou.');
    });
  }

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
    this.dismissLifecycleDialog();
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
        this.dismissLifecycleDialog();
    }
  }

  private openLifecycleDialog(intent: AccountLifecycleDialogIntent): void {
    const session = this.accountReauthentication.captureSensitiveActionSession();
    if (!session) return;
    this.dialogSession.set(session);
    this.lifecycleReauthenticationMode.set(
      this.accountReauthentication.getCurrentMode()
    );
    this.lifecycleDialogIntent.set(intent);
  }

  private dismissLifecycleDialog(): void {
    this.dialogSession.set(null);
    this.lifecycleDialogIntent.set(null);
  }

  private executeReactivateSelfSuspension(password?: string | null): void {
    if (this.isBusy()) return;

    this.busyAction.set('reactivate');

    this.accountReauthentication
      .runSensitiveAction$(this.dialogSession(), password, (uid) =>
        this.accountLifecycleService.reactivateSelfSuspension$(uid).pipe(
          switchMap((result) => this.waitForLifecycleChange$(uid, 'self_suspended').pipe(
            map((accountStatus) => ({ result, accountStatus }))
          ))
        )
      )
      .pipe(
        finalize(() => this.busyAction.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ result, accountStatus }) => {
          this.dismissLifecycleDialog();
          this.notify.showSuccess(
            result.message ?? 'Conta reativada com sucesso.'
          );

          if (result.subscriptionRenewalStatus === 'canceled') {
            this.notify.showInfo(
              'A renovação automática permanece cancelada. Revise sua assinatura se quiser voltar a renovar o plano.'
            );
          }

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
        error: (error: unknown) => {
          if (isAccountActionSessionChanged(error)) this.dismissLifecycleDialog();
        },
      });
  }

  private executeCancelDeletion(password?: string | null): void {
    if (this.isBusy()) return;

    this.busyAction.set('cancel_deletion');

    this.accountReauthentication
      .runSensitiveAction$(this.dialogSession(), password, (uid) =>
        this.accountLifecycleService.cancelAccountDeletion$(uid).pipe(
          switchMap((result) => this.waitForLifecycleChange$(uid, 'pending_deletion').pipe(
            map((accountStatus) => ({ result, accountStatus }))
          ))
        )
      )
      .pipe(
        finalize(() => this.busyAction.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ result, accountStatus }) => {
          this.dismissLifecycleDialog();
          this.notify.showSuccess(
            result.message ?? 'Exclusão cancelada com sucesso.'
          );

          if (result.subscriptionRenewalStatus === 'canceled') {
            this.notify.showInfo(
              'A renovação automática permanece cancelada por segurança. Revise sua assinatura se quiser voltar a renovar o plano.'
            );
          }

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
        error: (error: unknown) => {
          if (isAccountActionSessionChanged(error)) this.dismissLifecycleDialog();
        },
      });
  }

  /**
   * O backend é a autoridade do lifecycle. Depois da callable, aguardamos a
   * hidratação oficial Firestore -> Store em vez de fabricar um estado local por
   * `CurrentUserStoreService.patch()`.
   */
  private waitForLifecycleChange$(
    expectedUid: string,
    previousStatus: RuntimeAccountLifecycleStatus
  ): Observable<RuntimeAccountLifecycleStatus | null> {
    return this.currentUserStore.user$.pipe(
      filter((user) => user?.uid === expectedUid),
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

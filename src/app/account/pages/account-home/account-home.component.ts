// src/app/account/pages/account-home/account-home.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { finalize, firstValueFrom, of } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccountFacade } from '../../application/account.facade';
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
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { IncompleteProfileSubscriptionNoticeService } from 'src/app/subscriptions/application/incomplete-profile-subscription-notice.service';
import { SubscriptionCheckoutFacade } from 'src/app/subscriptions/application/subscription-checkout.facade';

@Component({
  selector: 'app-account-home',
  standalone: true,
  imports: [CommonModule, RouterModule, AccountLifecycleDialogComponent],
  providers: [SubscriptionCheckoutFacade],
  templateUrl: './account-home.component.html',
  styleUrl: './account-home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountHomeComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly noticeService = inject(
    IncompleteProfileSubscriptionNoticeService
  );
  private readonly subscriptionCheckoutFacade = inject(
    SubscriptionCheckoutFacade
  );
  private readonly accountLifecycleFacade = inject(AccountLifecycleFacade);
  private readonly accountLifecycleService = inject(AccountLifecycleService);
  private readonly accountReauthentication = inject(
    AccountReauthenticationService
  );
  private readonly notify = inject(ErrorNotificationService);

  readonly accountFacade = inject(AccountFacade);
  readonly vm$ = this.accountFacade.vm$;

  readonly currentUser$ = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly shouldUseStatusPage$ =
    this.accountLifecycleFacade.shouldUseStatusPage$;

  readonly shouldShowPostPaymentNotice$ = this.noticeService.shouldShow$(
    this.currentUser$,
    of('post-payment')
  );

  readonly shouldShowIncompleteProfileBanner$ = this.noticeService.shouldShow$(
    this.currentUser$,
    of('account')
  );

  readonly lifecycleDialogIntent =
    signal<AccountLifecycleDialogIntent | null>(null);
  readonly lifecycleBusyIntent =
    signal<AccountLifecycleDialogIntent | null>(null);
  readonly lifecycleReauthenticationMode =
    signal<AccountReauthenticationMode>('unsupported');

  readonly isLifecycleBusy = computed(
    () => this.lifecycleBusyIntent() !== null
  );

  ngOnInit(): void {
    this.currentUser$
      .pipe(
        tap((user) => {
          this.noticeService.hydrate(user?.uid);

          if (user?.profileCompleted === true) {
            this.noticeService.clear(user.uid);
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.subscriptionCheckoutFacade
      .processSuccessfulReturn$(this.route.queryParamMap)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();

    this.shouldUseStatusPage$
      .pipe(
        distinctUntilChanged(),
        tap((shouldUseStatusPage) => {
          if (!shouldUseStatusPage) return;

          this.router.navigate(['/conta/status'], {
            replaceUrl: true,
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  async onCompleteProfile(): Promise<void> {
    const user = await firstValueFrom(this.currentUser$.pipe(take(1))).catch(
      () => null
    );

    if (user?.emailVerified !== true) {
      this.router.navigate(['/register/welcome'], {
        queryParams: {
          autocheck: '1',
          reason: 'email_unverified',
          redirectTo: '/conta',
        },
      });
      return;
    }

    this.router.navigate(['/register/finalizar-cadastro'], {
      queryParams: {
        reason: 'profile_incomplete',
        redirectTo: '/conta',
      },
    });
  }

  onSnoozeIncompleteProfileBanner(user: unknown): void {
    const currentUser = user as { uid?: string } | null;
    if (!currentUser?.uid) return;

    this.noticeService.snooze(currentUser.uid, 7);
  }

  onDismissPostPaymentNotice(user: unknown): void {
    const currentUser = user as { uid?: string } | null;
    if (!currentUser?.uid) return;

    this.noticeService.markShown(currentUser.uid);
  }

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

  onLifecycleDialogConfirmed(
    event: AccountLifecycleDialogConfirmEvent
  ): void {
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
        switchMap(() =>
          this.accountLifecycleService.requestSelfSuspension$(reason)
        ),
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
            statusUpdatedAt:
              this.normalizeEpoch(result.statusUpdatedAt) ?? Date.now(),
            statusUpdatedBy: 'self',
          });

          this.lifecycleDialogIntent.set(null);
          this.notify.showSuccess(
            result.message ?? 'Conta suspensa com sucesso.'
          );

          this.router.navigate(['/conta/status'], {
            replaceUrl: true,
          });
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
        switchMap(() =>
          this.accountLifecycleService.requestAccountDeletion$(reason)
        ),
        finalize(() => this.lifecycleBusyIntent.set(null)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (result) => {
          const statusUpdatedAt =
            this.normalizeEpoch(result.statusUpdatedAt) ?? Date.now();

          this.currentUserStore.patch({
            accountStatus: 'pending_deletion',
            publicVisibility: 'hidden',
            interactionBlocked: true,
            loginAllowed: true,
            suspended: false,
            suspensionReason: null,
            suspensionSource: null,
            suspensionEndsAt: null,
            deletionRequestedAt:
              this.normalizeEpoch(result.deletionRequestedAt) ??
              statusUpdatedAt,
            deletionRequestedBy: 'self',
            deletionUndoUntil: this.normalizeEpoch(
              result.deletionUndoUntil
            ),
            purgeAfter: this.normalizeEpoch(result.purgeAfter),
            statusUpdatedAt,
            statusUpdatedBy: 'self',
          });

          this.lifecycleDialogIntent.set(null);
          this.notify.showSuccess(
            result.message ?? 'Exclusão da conta iniciada.'
          );

          this.router.navigate(['/conta/status'], {
            replaceUrl: true,
          });
        },
        error: () => {
          // Reautenticação e lifecycle centralizam diagnóstico e feedback.
        },
      });
  }

  private normalizeEpoch(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.trunc(parsed)
      : null;
  }
}

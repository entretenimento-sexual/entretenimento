//src\app\account\pages\account-home\account-home.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { combineLatest, of } from 'rxjs';
import { distinctUntilChanged, map, shareReplay, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccountFacade } from '../../application/account.facade';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { IncompleteProfileSubscriptionNoticeService } from 'src/app/subscriptions/application/incomplete-profile-subscription-notice.service';

@Component({
  selector: 'app-account-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './account-home.component.html',
  styleUrl: './account-home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountHomeComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly noticeService = inject(IncompleteProfileSubscriptionNoticeService);

  readonly accountFacade = inject(AccountFacade);
  readonly vm$ = this.accountFacade.vm$;

  readonly currentUser$ = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly billingSuccess$ = this.route.queryParamMap.pipe(
    map((params) => {
      const billing = (params.get('billing') ?? '').trim().toLowerCase();
      return billing.startsWith('success');
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly shouldShowPostPaymentNotice$ = combineLatest([
    this.currentUser$,
    this.billingSuccess$,
    this.noticeService.shouldShow$(this.currentUser$, of('post-payment')),
  ]).pipe(
    map(([user, billingSuccess, shouldShow]) => {
      return !!user?.uid && billingSuccess && shouldShow;
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly shouldShowIncompleteProfileBanner$ = this.noticeService.shouldShow$(
    this.currentUser$,
    of('account')
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

    combineLatest([this.currentUser$, this.billingSuccess$])
      .pipe(
        tap(([user, billingSuccess]) => {
          if (user?.uid && billingSuccess) {
            this.noticeService.markPaymentSuccess(user.uid);
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  onCompleteProfile(): void {
    this.router.navigate(['/register/finalizar-cadastro']);
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
}
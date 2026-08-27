// src/app/account/pages/account-home/account-home.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { of } from 'rxjs';
import { distinctUntilChanged, map, shareReplay, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccountFacade } from '../../application/account.facade';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { IncompleteProfileSubscriptionNoticeService } from 'src/app/subscriptions/application/incomplete-profile-subscription-notice.service';
import { SubscriptionCheckoutFacade } from 'src/app/subscriptions/application/subscription-checkout.facade';

@Component({
  selector: 'app-account-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  providers: [SubscriptionCheckoutFacade],
  templateUrl: './account-home.component.html',
  styleUrl: '../account-section.css',
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

  readonly accountFacade = inject(AccountFacade);
  readonly vm$ = this.accountFacade.vm$;

  readonly currentUser$ = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly shouldShowPostPaymentNotice$ = this.noticeService.shouldShow$(
    this.currentUser$,
    of('post-payment')
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

    // Compatibilidade com retornos legados de checkout que ainda chegam em /conta.
    this.subscriptionCheckoutFacade
      .processSuccessfulReturn$(this.route.queryParamMap)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  onCompleteProfile(): void {
    const user = this.currentUserStore.getSnapshot();

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
}

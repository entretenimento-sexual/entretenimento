// src/app/subscriptions/subscription-plan/subscription-plan.component.ts
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { map, distinctUntilChanged, shareReplay, tap } from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { IncompleteProfileSubscriptionNoticeService } from '../application/incomplete-profile-subscription-notice.service';

@Component({
  selector: 'app-subscription-plan',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './subscription-plan.component.html',
  styleUrls: ['./subscription-plan.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubscriptionPlanComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly noticeService = inject(IncompleteProfileSubscriptionNoticeService);

  readonly currentUser$ = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly shouldShowSubscriptionWarning$ = this.noticeService.shouldShow$(
    this.currentUser$,
    this.buildStaticContext$('subscription-plan')
  );

  readonly subscriptionWarningItems = [
    'sua conta premium será ativada normalmente',
    'sua visibilidade pode continuar reduzida',
    'você pode ter limitações para ser encontrado ou iniciar algumas interações',
  ];

  ngOnInit(): void {
    this.currentUser$
      .pipe(
        tap((user) => {
          this.noticeService.hydrate(user?.uid);
        })
      )
      .subscribe();
  }

  subscribe(plan: 'basic' | 'premium' | 'vip'): void {
    this.router.navigate(['/checkout'], {
      queryParams: { plan }
    });
  }

  private buildStaticContext$(context: 'subscription-plan') {
    return this.currentUser$.pipe(
      map(() => context),
      distinctUntilChanged()
    );
  }
}
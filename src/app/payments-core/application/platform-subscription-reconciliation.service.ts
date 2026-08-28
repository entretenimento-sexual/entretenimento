// src/app/payments-core/application/platform-subscription-reconciliation.service.ts
// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION RECONCILIATION SERVICE
// -----------------------------------------------------------------------------
// No bootstrap autenticado, consulta o snapshot sanitizado do entitlement.
// Aguarda a sessão e o perfil atual apontarem para o mesmo UID, evitando perder
// a resposta antes da hidratação do CurrentUserStoreService.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Subscription, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  switchMap,
  tap,
} from 'rxjs/operators';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { BillingRepository } from '../infrastructure/repositories/billing.repository';
import type { BillingSnapshotResult } from '../domain/models/billing-return.model';
import {
  PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
  isPlatformSubscriptionRole,
} from '@core/services/subscriptions/platform-subscription-access.model';

@Injectable({ providedIn: 'root' })
export class PlatformSubscriptionReconciliationService {
  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly billingRepository = inject(BillingRepository);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private subscription: Subscription | null = null;

  start(): void {
    if (this.subscription && !this.subscription.closed) return;

    this.subscription = combineLatest([
      this.session.ready$,
      this.session.uid$,
      this.currentUserStore.user$,
    ])
      .pipe(
        map(([ready, authUid, currentUser]) =>
          ready === true &&
          !!authUid &&
          !!currentUser &&
          currentUser.uid === authUid
            ? authUid
            : null
        ),
        distinctUntilChanged(),
        filter((uid): uid is string => !!uid),
        switchMap((uid) =>
          this.billingRepository.getMyBillingSnapshot$().pipe(
            tap((snapshot) => this.applySnapshot(uid, snapshot)),
            catchError((error) => {
              this.reportError(error, uid);
              return of(null);
            })
          )
        )
      )
      .subscribe();
  }

  private applySnapshot(
    uid: string,
    snapshot: BillingSnapshotResult | null
  ): void {
    const current = this.currentUserStore.getSnapshot();
    if (!current || current.uid !== uid || !snapshot) return;

    const now = Date.now();
    const role = isPlatformSubscriptionRole(snapshot.role)
      ? snapshot.role
      : isPlatformSubscriptionRole(snapshot.tier)
        ? snapshot.tier
        : null;
    const startsAt = this.toFiniteNumber(snapshot.startsAt);
    const endsAt = this.toFiniteNumber(snapshot.endsAt);
    const active =
      snapshot.projectionVersion === PLATFORM_SUBSCRIPTION_PROJECTION_VERSION &&
      snapshot.status === 'active' &&
      snapshot.isSubscriber === true &&
      snapshot.entitlements?.includes('platform_subscription') === true &&
      role !== null &&
      startsAt !== null &&
      startsAt <= now &&
      endsAt !== null &&
      endsAt > now;
    const preserveAdmin = current.role === 'admin';

    this.currentUserStore.patch({
      role: preserveAdmin ? 'admin' : active ? role! : 'free',
      tier: active ? role : 'free',
      billingProjectionVersion: PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
      isSubscriber: active,
      monthlyPayer: active,
      subscriptionStatus: active ? 'active' : 'inactive',
      subscriptionScope: active ? 'platform_subscription' : null,
      subscriptionStartedAt: startsAt,
      subscriptionEndsAt: endsAt,
      subscriptionExpires: endsAt,
      billingUpdatedAt: this.toFiniteNumber(snapshot.updatedAt),
    });
  }

  private toFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : null;
  }

  private reportError(error: unknown, uid: string): void {
    try {
      const normalized =
        error instanceof Error ? error : new Error(String(error));

      (normalized as any).context = {
        scope: 'PlatformSubscriptionReconciliationService',
        uid,
      };
      (normalized as any).silent = true;
      (normalized as any).skipUserNotification = true;
      this.globalError.handleError(normalized);
    } catch {
      // A reconciliação é resiliente; listener e rotina agendada permanecem.
    }
  }
}

// src/app/payments-core/application/platform-subscription-reconciliation.service.ts
// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION RECONCILIATION SERVICE
// -----------------------------------------------------------------------------
// No bootstrap autenticado, consulta o snapshot sanitizado do entitlement.
// A callable reconcilia a projeção backend-authoritative em users/{uid}; o
// listener realtime oficial do usuário publica essa mudança no runtime.
// Este serviço nunca fabrica role/tier/isSubscriber localmente.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Subscription, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  switchMap,
} from 'rxjs/operators';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { BillingRepository } from '../infrastructure/repositories/billing.repository';

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
            catchError((error) => {
              this.reportError(error, uid);
              return of(null);
            })
          )
        )
      )
      .subscribe();
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

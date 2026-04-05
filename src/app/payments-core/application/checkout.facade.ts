//src\app\payments-core\application\checkout.facade.ts
import { Injectable, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import { BillingPlan } from '../domain/models/billing-plan.model';
import { BillingRepository } from '../infrastructure/repositories/billing.repository';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class CheckoutFacade {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly billingRepository = inject(BillingRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  readonly planKey$ = this.route.queryParamMap.pipe(
    map((params) => (params.get('plan') ?? '').trim().toLowerCase()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly plan$: Observable<BillingPlan | null> = this.planKey$.pipe(
    switchMap((planKey) => {
      if (!planKey) return of(null);
      return this.billingRepository.getPlatformPlanByKey$(planKey);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  startCheckout$(): Observable<string | null> {
    return this.plan$.pipe(
      switchMap((plan) => {
        if (!plan) return of(null);
        return this.billingRepository.createPlatformCheckoutSession$(plan);
      }),
      map((session) => session?.checkoutUrl ?? null),
      catchError((error) => {
        try {
          this.errorNotifier.showError(
            'Não foi possível iniciar o checkout.'
          );
        } catch {}

        try {
          (error as any).context = {
            scope: 'CheckoutFacade',
            op: 'startCheckout$',
          };
          (error as any).skipUserNotification = true;
          this.globalError.handleError(error);
        } catch {}

        return of(null);
      })
    );
  }

  goBackToPlans(): Promise<boolean> {
    return this.router.navigate(['/subscription-plan']);
  }
}
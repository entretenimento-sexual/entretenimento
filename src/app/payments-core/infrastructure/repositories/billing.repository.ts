//src\app\payments-core\infrastructure\repositories\billing.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { BillingPlan } from '../../domain/models/billing-plan.model';
import { CreateCheckoutResult } from '../../domain/ports/payment-provider.port';

@Injectable({ providedIn: 'root' })
export class BillingRepository {
  private readonly functions = inject(Functions);

  getPlatformPlanByKey$(planKey: string): Observable<BillingPlan | null> {
    const callable = httpsCallable<{ key: string }, BillingPlan | null>(
      this.functions,
      'getPlatformPlanByKey'
    );

    return from(callable({ key: planKey })).pipe(
      map((result) => result.data ?? null)
    );
  }

  createPlatformCheckoutSession$(
    plan: BillingPlan
  ): Observable<CreateCheckoutResult | null> {
    const callable = httpsCallable<
      { planId: string; planKey: string },
      CreateCheckoutResult | null
    >(this.functions, 'createPlatformCheckoutSession');

    return from(
      callable({
        planId: plan.id,
        planKey: String(plan.key),
      })
    ).pipe(
      map((result) => result.data ?? null)
    );
  }
}
//src\app\payments-core\infrastructure\repositories\billing.repository.ts
//Não esquecer de comentários explicativos e ferramentas de debug
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { BillingPlan } from '../../domain/models/billing-plan.model';
import { CreateCheckoutResult } from '../../domain/ports/payment-provider.port';

@Injectable({ providedIn: 'root' })
export class BillingRepository {
  private readonly functions = inject(Functions);

  private readonly getPlatformPlanByKeyCallable = httpsCallable<
    { key: string },
    BillingPlan | null
  >(this.functions, 'getPlatformPlanByKey');

  private readonly createPlatformCheckoutSessionCallable = httpsCallable<
    { planId: string; planKey: string },
    CreateCheckoutResult | null
  >(this.functions, 'createPlatformCheckoutSession');

  getPlatformPlanByKey$(planKey: string): Observable<BillingPlan | null> {
    return from(this.getPlatformPlanByKeyCallable({ key: planKey })).pipe(
      map((result) => result.data ?? null)
    );
  }

  createPlatformCheckoutSession$(
    plan: BillingPlan
  ): Observable<CreateCheckoutResult | null> {
    return from(
      this.createPlatformCheckoutSessionCallable({
        planId: plan.id,
        planKey: String(plan.key),
      })
    ).pipe(
      map((result) => result.data ?? null)
    );
  }
}
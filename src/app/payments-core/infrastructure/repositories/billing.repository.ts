//Não esquecer de comentários explicativos e ferramentas de debug
// src/app/payments-core/infrastructure/repositories/billing.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { BillingPlan } from '../../domain/models/billing-plan.model';
import {
  BillingSnapshotResult,
  ProcessBillingReturnInput,
  ProcessBillingReturnResult,
} from '../../domain/models/billing-return.model';
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

  /**
   * Esperado no backend:
   * - recebe o retorno do provider/gateway
   * - valida pagamento/cancelamento
   * - atualiza checkout session
   * - atualiza role/tier/entitlements quando aplicável
   * - devolve o status final ou "processing"
   */
  private readonly processBillingReturnCallable = httpsCallable<
    ProcessBillingReturnInput,
    ProcessBillingReturnResult | null
  >(this.functions, 'processBillingReturn');

  /**
   * Esperado no backend:
   * - devolve o estado consolidado atual do billing do usuário autenticado
   * - útil para polling curto e sincronização final antes de navegar
   */
  private readonly getMyBillingSnapshotCallable = httpsCallable<
    Record<string, never>,
    BillingSnapshotResult | null
  >(this.functions, 'getMyBillingSnapshot');

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

  processBillingReturn$(
    input: ProcessBillingReturnInput
  ): Observable<ProcessBillingReturnResult | null> {
    return from(this.processBillingReturnCallable(input)).pipe(
      map((result) => result.data ?? null)
    );
  }

  getMyBillingSnapshot$(): Observable<BillingSnapshotResult | null> {
    return from(this.getMyBillingSnapshotCallable({})).pipe(
      map((result) => result.data ?? null)
    );
  }
}
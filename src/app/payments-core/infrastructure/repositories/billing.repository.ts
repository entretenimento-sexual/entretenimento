// src/app/payments-core/infrastructure/repositories/billing.repository.ts
// -----------------------------------------------------------------------------
// BILLING REPOSITORY
// -----------------------------------------------------------------------------
//
// Adapter AngularFire para as callable functions do domínio de billing.
//
// Responsabilidade:
// - encapsular comunicação com Functions;
// - devolver Observables para a camada de aplicação;
// - não manter regra de negócio financeira no frontend.
//
// Segurança:
// - o repository envia somente intenção de escolha de plano e identificador da
//   sessão no retorno;
// - valores, role, provider confirmado e entitlement são decididos no backend;
// - processBillingReturn não confirma pagamento por parâmetros da URL em cloud;
// - getMyBillingSnapshot devolve projeção sanitizada do entitlement válido.
//
// Tratamento de erro:
// - erros continuam sendo tratados pela facade, integrada a
//   ErrorNotificationService e GlobalErrorHandlerService.
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
import {
  CreateCheckoutResult,
} from '../../domain/models/checkout-session-response.model';

@Injectable({ providedIn: 'root' })
export class BillingRepository {
  private readonly functions = inject(Functions);

  /**
   * Consulta o catálogo reconhecido pelo backend.
   *
   * O plano retornado serve para apresentação e escolha. A criação do checkout
   * resolve o plano novamente no backend antes de persistir qualquer sessão.
   */
  private readonly getPlatformPlanByKeyCallable = httpsCallable<
    { key: string },
    BillingPlan | null
  >(this.functions, 'getPlatformPlanByKey');

  /**
   * Cria intenção de assinatura.
   *
   * Em dev-emu:
   * - utiliza provider local controlado pelo Functions Emulator.
   *
   * Em cloud:
   * - deve permanecer bloqueado até existir gateway real validado.
   */
  private readonly createPlatformCheckoutSessionCallable = httpsCallable<
    { planId: string; planKey: string },
    CreateCheckoutResult | null
  >(this.functions, 'createPlatformCheckoutSession');

  /**
   * Processa a experiência visual de retorno.
   *
   * O retorno do navegador não comprova pagamento. O backend somente concede
   * acesso no Emulator controlado ou após evento real verificado futuramente.
   */
  private readonly processBillingReturnCallable = httpsCallable<
    ProcessBillingReturnInput,
    ProcessBillingReturnResult | null
  >(this.functions, 'processBillingReturn');

  /**
   * Consulta projeção sanitizada do entitlement ativo do usuário.
   *
   * A interface não acessa diretamente entitlements, transactions, events ou
   * audit logs financeiros.
   */
  private readonly getMyBillingSnapshotCallable = httpsCallable<
    Record<string, never>,
    BillingSnapshotResult | null
  >(this.functions, 'getMyBillingSnapshot');

  getPlatformPlanByKey$(
    planKey: string
  ): Observable<BillingPlan | null> {
    return from(
      this.getPlatformPlanByKeyCallable({ key: planKey })
    ).pipe(
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
    return from(
      this.processBillingReturnCallable(input)
    ).pipe(
      map((result) => result.data ?? null)
    );
  }

  getMyBillingSnapshot$(): Observable<BillingSnapshotResult | null> {
    return from(
      this.getMyBillingSnapshotCallable({})
    ).pipe(
      map((result) => result.data ?? null)
    );
  }
}
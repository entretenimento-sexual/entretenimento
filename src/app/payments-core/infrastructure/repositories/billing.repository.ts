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
// - snapshots e histórico são projeções sanitizadas; collections financeiras
//   internas continuam inacessíveis ao navegador.
//
// Tratamento de erro:
// - erros continuam sendo tratados pela facade/component chamador, integrados a
//   ErrorNotificationService e GlobalErrorHandlerService.
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import {
  BillingPlan,
  type PlatformPlanKey,
} from '../../domain/models/billing-plan.model';
import {
  BillingSnapshotResult,
  ProcessBillingReturnInput,
  ProcessBillingReturnResult,
} from '../../domain/models/billing-return.model';
import {
  CreateCheckoutResult,
} from '../../domain/models/checkout-session-response.model';
import {
  PlatformSubscriptionHistoryPage,
} from '../../domain/models/platform-subscription-history.model';

interface PlatformCheckoutFlowContext {
  minimumRole: PlatformPlanKey | null;
  returnUrl: string | null;
}

interface PlatformSubscriptionHistoryRequest {
  cursor?: string | null;
  limit?: number | null;
}

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
    {
      planId: string;
      planKey: string;
      minimumRole?: PlatformPlanKey;
      returnUrl?: string;
    },
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

  /**
   * Consulta a trilha sanitizada da própria assinatura.
   *
   * billing_audit continua privado; o backend remove IDs financeiros internos e
   * retorna apenas a sequência de mudanças que interessa ao titular da conta.
   */
  private readonly getMyPlatformSubscriptionHistoryCallable = httpsCallable<
    PlatformSubscriptionHistoryRequest,
    PlatformSubscriptionHistoryPage | null
  >(this.functions, 'getMyPlatformSubscriptionHistory');

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
    plan: BillingPlan,
    flowContext: PlatformCheckoutFlowContext
  ): Observable<CreateCheckoutResult | null> {
    const request: {
      planId: string;
      planKey: string;
      minimumRole?: PlatformPlanKey;
      returnUrl?: string;
    } = {
      planId: plan.id,
      planKey: String(plan.key),
    };

    if (flowContext.minimumRole) {
      request.minimumRole = flowContext.minimumRole;
    }

    if (flowContext.returnUrl) {
      request.returnUrl = flowContext.returnUrl;
    }

    return from(
      this.createPlatformCheckoutSessionCallable(request)
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

  getMyPlatformSubscriptionHistory$(
    cursor: string | null = null,
    limit = 25
  ): Observable<PlatformSubscriptionHistoryPage> {
    return from(
      this.getMyPlatformSubscriptionHistoryCallable({ cursor, limit })
    ).pipe(
      map((result) => result.data ?? { items: [], nextCursor: null })
    );
  }
}

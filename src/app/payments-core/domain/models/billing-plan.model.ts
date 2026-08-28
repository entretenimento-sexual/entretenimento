// src/app/payments-core/domain/models/billing-plan.model.ts
// -----------------------------------------------------------------------------
// BILLING PLAN MODELS
// -----------------------------------------------------------------------------
//
// Modelos expostos à interface para seleção de assinatura da plataforma.
//
// Segurança:
// - este contrato serve para apresentação visual e criação da intenção de
//   checkout;
// - preço, moeda, role concedida e validade do plano são revalidados no
//   backend antes de qualquer sessão ser persistida;
// - o frontend não concede entitlement nem interpreta pagamento.
//
// Escalabilidade:
// - BillingScope já prevê domínios futuros como assinatura de criador,
//   mimos e mídia paga;
// - BillingPlan, nesta etapa, representa exclusivamente os planos mensais da
//   própria plataforma;
// - futuros produtos deverão ganhar modelos próprios, evitando misturar
//   mensalidade da plataforma com monetização entre usuários.

export type PlatformPlanKey = 'basic' | 'premium' | 'vip';

export type BillingProvider =
  | 'emulator'
  | 'asaas'
  | 'pagarme'
  | 'mercadopago';

export type BillingScope =
  | 'platform_subscription'
  | 'creator_subscription'
  | 'tip'
  | 'paid_media'
  | 'paid_live';

export interface BillingPlan {
  id: string;
  key: PlatformPlanKey;

  /**
   * O catálogo atualmente apresentado pela UI representa somente assinatura
   * da própria plataforma.
   */
  scope: 'platform_subscription';

  title: string;
  description: string;

  amountCents: number;
  currency: 'BRL';

  interval: 'month';

  active: boolean;

  /**
   * Metadados opcionais de leitura. A UI não os utiliza como autorização.
   */
  createdAt?: number;
  updatedAt?: number;
}
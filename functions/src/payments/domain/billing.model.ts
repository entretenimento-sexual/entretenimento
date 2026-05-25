// functions/src/payments/domain/billing.model.ts
// -----------------------------------------------------------------------------
// BILLING DOMAIN MODELS
// -----------------------------------------------------------------------------
//
// Modelos canônicos do domínio financeiro da plataforma.
//
// Objetivos:
// - evitar contratos diferentes entre checkout, webhook e entitlement;
// - suportar crescimento para assinaturas, mídia paga, lives e benefícios;
// - manter o navegador fora da autoridade de confirmação financeira;
// - preparar auditoria, estorno, chargeback e reconciliação.
//
// Regra central:
// - checkout representa intenção;
// - payment event representa confirmação validada;
// - transaction representa movimentação financeira normalizada;
// - entitlement representa acesso concedido.

export const BILLING_SCOPE_VALUES = [
  'platform_subscription',
  'creator_subscription',
  'tip',
  'paid_media',
  'paid_live',
] as const;

export type BillingScope = (typeof BILLING_SCOPE_VALUES)[number];

export const PLATFORM_PLAN_KEYS = ['basic', 'premium', 'vip'] as const;

export type PlatformPlanKey = (typeof PLATFORM_PLAN_KEYS)[number];

export type PlatformRole = 'basic' | 'premium' | 'vip';

export type BillingProviderId =
  | 'emulator'
  | 'asaas'
  | 'pagarme'
  | 'mercadopago';

export type CheckoutSessionStatus =
  | 'pending'
  | 'provider_created'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'refunded'
  | 'chargeback';

export type PaymentTransactionStatus =
  | 'paid'
  | 'refunded'
  | 'chargeback';

export type PaymentVerificationMode =
  | 'emulator'
  | 'verified_webhook_signature';

export interface BillingPlan {
  id: string;
  key: PlatformPlanKey;
  scope: 'platform_subscription';
  title: string;
  description: string;
  amountCents: number;
  currency: 'BRL';
  interval: 'month';
  active: boolean;

  /**
   * Projeção autorizativa que será aplicada somente após settlement válido.
   */
  grantedRole: PlatformRole;

  /**
   * Permite evoluir regras/preços mantendo rastreabilidade dos checkouts.
   */
  catalogVersion: number;
}

export interface BillingPlanSnapshot extends BillingPlan {
  snapshotAt: number;
}

export interface CheckoutStatusHistoryItem {
  status: CheckoutSessionStatus;
  at: number;
  source: 'system' | 'provider' | 'emulator' | 'admin';
  eventId?: string | null;
}

export interface CheckoutSessionDoc {
  id: string;
  buyerUid: string;
  sellerUid?: string | null;

  scope: BillingScope;

  planId?: string | null;
  planKey?: PlatformPlanKey | null;
  planSnapshot?: BillingPlanSnapshot | null;

  amountCents: number;
  currency: 'BRL';

  provider: BillingProviderId;
  providerSessionId?: string | null;
  checkoutUrl?: string | null;

  status: CheckoutSessionStatus;
  statusHistory?: CheckoutStatusHistoryItem[];

  createdAt: number;
  updatedAt: number;

  /**
   * Apenas metadados internos mínimos. Não armazenar payload financeiro
   * sensível ou dados pessoais desnecessários.
   */
  metadata?: Record<string, unknown>;
}

export interface VerifiedPaymentEvent {
  provider: BillingProviderId;
  providerEventId: string;
  providerSessionId?: string | null;
  checkoutSessionId: string;

  financialStatus: 'paid' | 'refunded' | 'chargeback';

  amountCents: number;
  currency: 'BRL';

  verified: true;
  verificationMode: PaymentVerificationMode;

  receivedAt: number;

  /**
   * Futuro: hash de payload sanitizado para auditoria, sem persistir
   * informações pessoais ou segredos do webhook.
   */
  sanitizedPayloadHash?: string | null;
}

export interface PaymentEventDoc {
  id: string;
  provider: BillingProviderId;
  providerEventId: string;
  providerSessionId?: string | null;
  checkoutSessionId: string;

  status: PaymentTransactionStatus;
  amountCents: number;
  currency: 'BRL';

  verified: true;
  verificationMode: PaymentVerificationMode;

  sanitizedPayloadHash?: string | null;

  processed: boolean;
  processedAt: number;
  createdAt: number;
}

export interface PaymentTransactionDoc {
  id: string;
  checkoutSessionId: string;
  paymentEventId: string;

  buyerUid: string;
  sellerUid?: string | null;

  scope: BillingScope;
  provider: BillingProviderId;
  providerSessionId?: string | null;

  status: PaymentTransactionStatus;

  amountCents: number;
  currency: 'BRL';

  planId?: string | null;
  planKey?: PlatformPlanKey | null;

  createdAt: number;
  updatedAt: number;
}

export interface EntitlementDoc {
  id: string;

  buyerUid: string;
  sellerUid?: string | null;

  scope: BillingScope;

  planId?: string | null;
  planKey?: PlatformPlanKey | null;
  grantedRole?: PlatformRole | null;

  active: boolean;

  startsAt: number;
  endsAt?: number | null;

  sourceCheckoutSessionId: string;
  sourcePaymentTransactionId: string;

  createdAt: number;
  updatedAt: number;
}

export interface SettlementResult {
  processed: boolean;
  idempotent: boolean;

  checkoutSessionId: string;
  paymentEventId: string;
  transactionId: string;
  entitlementId?: string | null;

  scope: BillingScope;
  status: PaymentTransactionStatus;

  role?: PlatformRole | null;
  accessGranted: boolean;
}
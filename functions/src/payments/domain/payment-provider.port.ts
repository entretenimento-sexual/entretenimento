// functions/src/payments/domain/payment-provider.port.ts
// -----------------------------------------------------------------------------
// PAYMENT PROVIDER PORT
// -----------------------------------------------------------------------------
//
// Contrato comum para provedores externos e provider local do Emulator.
//
// Segurança:
// - criar checkout não confirma pagamento;
// - retorno do navegador não confirma pagamento;
// - somente evento verificado pode alimentar settlement;
// - cada provider real deverá implementar verificação própria de webhook.
import {
  BillingPlanSnapshot,
  BillingProviderId,
  BillingScope,
  VerifiedPaymentEvent,
} from './billing.model';

export interface CreateCheckoutInput {
  checkoutSessionId: string;

  buyerUid: string;
  sellerUid?: string | null;

  scope: BillingScope;

  planSnapshot?: BillingPlanSnapshot | null;

  amountCents: number;
  currency: 'BRL';

  successUrl: string;
  cancelUrl: string;

  metadata?: Record<string, unknown>;
}

export interface CreateCheckoutResult {
  provider: BillingProviderId;
  providerSessionId: string;
  checkoutUrl: string;
  expiresAt?: number | null;
}

export interface ProviderWebhookInput {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
}

export abstract class PaymentProviderPort {
  abstract readonly providerId: BillingProviderId;

  abstract createCheckoutSession(
    input: CreateCheckoutInput
  ): Promise<CreateCheckoutResult>;

  abstract cancelCheckoutSession(
    providerSessionId: string
  ): Promise<void>;

  /**
   * Providers reais deverão:
   * - validar assinatura/segredo;
   * - validar evento;
   * - devolver somente um evento financeiramente confiável.
   */
  abstract verifyWebhook(
    input: ProviderWebhookInput
  ): Promise<VerifiedPaymentEvent>;
}
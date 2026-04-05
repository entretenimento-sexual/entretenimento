//functions\src\payments\domain\payment-provider.port.ts
export type BillingProvider = 'asaas' | 'pagarme' | 'mercadopago';
export type BillingScope =
  | 'platform_subscription'
  | 'creator_subscription'
  | 'tip'
  | 'paid_media'
  | 'paid_live';

export interface CreateCheckoutInput {
  buyerUid: string;
  sellerUid?: string;
  scope: BillingScope;
  planId?: string;
  planKey?: string;
  amountCents: number;
  currency: 'BRL';
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCheckoutResult {
  provider: BillingProvider;
  providerSessionId: string;
  checkoutUrl: string;
  expiresAt?: number | null;
}

export interface PaymentWebhookResult {
  accepted: boolean;
  eventId?: string;
  checkoutSessionId?: string;
  newStatus?: 'pending' | 'provider_created' | 'paid' | 'failed' | 'canceled';
}

export abstract class PaymentProviderPort {
  abstract createCheckoutSession(
    input: CreateCheckoutInput
  ): Promise<CreateCheckoutResult>;

  abstract cancelCheckoutSession(
    providerSessionId: string
  ): Promise<void>;

  abstract parseWebhook(
    headers: Record<string, string>,
    rawBody: string
  ): Promise<PaymentWebhookResult>;
}
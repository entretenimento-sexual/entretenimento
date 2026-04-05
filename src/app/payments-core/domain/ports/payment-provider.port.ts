//src\app\payments-core\domain\ports\payment-provider.port.ts
import { Observable } from 'rxjs';
import {
  BillingProvider,
  BillingScope,
} from '../models/billing-plan.model';
import { CheckoutStatus } from '../models/checkout-session.model';

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
  newStatus?: CheckoutStatus;
}

export abstract class PaymentProviderPort {
  abstract createCheckoutSession$(
    input: CreateCheckoutInput
  ): Observable<CreateCheckoutResult>;

  abstract cancelCheckoutSession$(
    providerSessionId: string
  ): Observable<void>;

  abstract parseWebhook$(
    headers: Record<string, string>,
    rawBody: string
  ): Observable<PaymentWebhookResult>;
}
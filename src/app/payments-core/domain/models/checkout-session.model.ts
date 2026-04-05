//src\app\payments-core\domain\models\checkout-session.model.ts
import { BillingProvider, BillingScope } from './billing-plan.model';

export type CheckoutStatus =
  | 'pending'
  | 'provider_created'
  | 'paid'
  | 'failed'
  | 'canceled';

export interface CheckoutSessionDoc {
  id: string;
  buyerUid: string;
  sellerUid?: string;
  scope: BillingScope;
  planId?: string;
  planKey?: string;
  amountCents: number;
  currency: 'BRL';
  provider: BillingProvider;
  providerSessionId?: string;
  providerReference?: string;
  checkoutUrl?: string;
  status: CheckoutStatus;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
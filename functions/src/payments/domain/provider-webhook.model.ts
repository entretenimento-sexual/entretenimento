// functions/src/payments/domain/provider-webhook.model.ts
// -----------------------------------------------------------------------------
// VERIFIED PROVIDER WEBHOOK MODEL
// -----------------------------------------------------------------------------
// Envelope mínimo e sanitizado. O payload bruto do provedor nunca é persistido.
// -----------------------------------------------------------------------------

import type {
  BillingProviderId,
  PaymentVerificationMode,
} from './billing.model';

export type ProviderWebhookResourceType =
  | 'checkout'
  | 'subscription'
  | 'payment'
  | 'other';

export interface VerifiedProviderWebhookEvent {
  provider: BillingProviderId;
  providerEventId: string;
  eventName: string;

  resourceType: ProviderWebhookResourceType;
  resourceId: string;

  checkoutId: string | null;
  subscriptionId: string | null;
  paymentId: string | null;
  customerId: string | null;
  externalReference: string | null;

  amountCents: number | null;
  currency: 'BRL';
  providerStatus: string | null;

  verified: true;
  verificationMode: PaymentVerificationMode;
  occurredAt: number;
  receivedAt: number;
  sanitizedPayloadHash: string;
}

export type ProviderWebhookProcessingStatus =
  | 'pending'
  | 'processing'
  | 'retry'
  | 'processed'
  | 'ignored'
  | 'failed';

export interface ProviderWebhookEventDoc
extends VerifiedProviderWebhookEvent {
  id: string;
  processingStatus: ProviderWebhookProcessingStatus;
  attemptCount: number;
  nextAttemptAt: number | null;
  processedAt: number | null;
  lastAttemptAt: number | null;
  lastErrorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

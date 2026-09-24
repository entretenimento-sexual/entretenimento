// functions/src/payments/domain/platform-recurring-subscription.model.ts
// -----------------------------------------------------------------------------
// PLATFORM RECURRING SUBSCRIPTION MODEL
// -----------------------------------------------------------------------------
// Contratos internos de recorrência. Cada assinatura externa do provedor ganha
// um documento próprio e o estado corrente do usuário é mantido em um ponteiro
// determinístico separado.
// -----------------------------------------------------------------------------

import type {
  BillingPlanSnapshot,
  BillingProviderId,
  PlatformPlanKey,
  PlatformRole,
} from './billing.model';

export interface PlatformRecurringPendingPlanChange {
  planId: string;
  planKey: PlatformPlanKey;
  grantedRole: PlatformRole;
  planSnapshot: BillingPlanSnapshot;
  amountCents: number;
  currency: 'BRL';
  effectiveAt: number;
  requestedAt: number;
  providerUpdateStatus: 'pending' | 'applied' | 'retry';
  providerUpdateAttemptCount: number;
  providerUpdateNextAttemptAt: number | null;
  providerUpdateLastErrorCode: string | null;
  providerUpdatedAt: number | null;
}

export type PlatformRecurringSubscriptionStatus =
  | 'pending_payment'
  | 'active'
  | 'past_due'
  | 'payment_failed'
  | 'canceled'
  | 'deleted'
  | 'superseded'
  | 'chargeback';

export interface PlatformRecurringSubscriptionDoc {
  id: string;
  buyerUid: string;
  scope: 'platform_subscription';

  provider: BillingProviderId;
  providerSubscriptionId: string;
  providerCustomerId: string | null;

  sourceCheckoutSessionId: string;

  planId: string;
  planKey: PlatformPlanKey;
  grantedRole: PlatformRole;
  planSnapshot: BillingPlanSnapshot;

  amountCents: number;
  currency: 'BRL';
  cycle: 'MONTHLY';

  status: PlatformRecurringSubscriptionStatus;
  renewalEnabled: boolean;
  isCurrent: boolean;

  lastSettledProviderPaymentId: string | null;
  lastPaymentStatus: string | null;
  lastPaymentOccurredAt: number | null;

  pendingPlanChange: PlatformRecurringPendingPlanChange | null;

  needsProviderCancellation: boolean;
  providerCancellationAttemptCount: number;
  providerCancellationNextAttemptAt: number | null;
  providerCancellationLastErrorCode: string | null;

  createdAt: number;
  activatedAt: number | null;
  canceledAt: number | null;
  supersededAt: number | null;
  updatedAt: number;
}

export interface PlatformRecurringSubscriptionStateDoc {
  buyerUid: string;
  currentContractId: string | null;
  currentProviderSubscriptionId: string | null;
  currentPlanKey: PlatformPlanKey | null;
  renewalEnabled: boolean;
  updatedAt: number;
}

export interface PlatformCheckoutLockDoc {
  buyerUid: string;
  checkoutSessionId: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

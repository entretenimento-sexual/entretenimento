// functions/src/payments/application/recurring-reconciliation-window.policy.ts
// -----------------------------------------------------------------------------
// RECURRING RECONCILIATION WINDOW POLICY
// -----------------------------------------------------------------------------
// Mantém workers financeiros bounded e ordenados pelo instante em que cada item
// se torna elegível. A policy não consulta Firestore e não concede entitlement.
// -----------------------------------------------------------------------------

import type {
  ProviderWebhookEventDoc,
} from '../domain/provider-webhook.model';
import type {
  PlatformRecurringSubscriptionDoc,
} from '../domain/platform-recurring-subscription.model';

export const PROVIDER_WEBHOOK_PROCESSING_LEASE_MS = 5 * 60 * 1_000;
export const PROVIDER_WEBHOOK_RECONCILIATION_LIMIT = 100;
export const RECURRING_PROVIDER_CANCELLATION_LIMIT = 100;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

export function providerWebhookEligibilityAt(
  event: Pick<
    ProviderWebhookEventDoc,
    | 'processingStatus'
    | 'createdAt'
    | 'receivedAt'
    | 'nextAttemptAt'
    | 'lastAttemptAt'
  >
): number | null {
  if (event.processingStatus === 'pending') {
    return finite(event.createdAt) ?? finite(event.receivedAt) ?? 0;
  }

  if (event.processingStatus === 'retry') {
    return finite(event.nextAttemptAt);
  }

  if (event.processingStatus === 'processing') {
    const lastAttemptAt = finite(event.lastAttemptAt);
    return lastAttemptAt === null
      ? 0
      : lastAttemptAt + PROVIDER_WEBHOOK_PROCESSING_LEASE_MS;
  }

  return null;
}

export function isProviderWebhookDue(
  event: Parameters<typeof providerWebhookEligibilityAt>[0],
  now: number
): boolean {
  const eligibilityAt = providerWebhookEligibilityAt(event);
  return eligibilityAt !== null && eligibilityAt <= now;
}

export function recurringCancellationEligibilityAt(
  contract: Pick<
    PlatformRecurringSubscriptionDoc,
    'needsProviderCancellation' | 'providerCancellationNextAttemptAt'
  >
): number | null {
  if (contract.needsProviderCancellation !== true) return null;

  return finite(contract.providerCancellationNextAttemptAt) ?? 0;
}

export function isRecurringCancellationDue(
  contract: Parameters<typeof recurringCancellationEligibilityAt>[0],
  now: number
): boolean {
  const eligibilityAt = recurringCancellationEligibilityAt(contract);
  return eligibilityAt !== null && eligibilityAt <= now;
}

export function compareEligibleAt(
  left: number,
  right: number,
  leftId: string,
  rightId: string
): number {
  return left - right || leftId.localeCompare(rightId);
}

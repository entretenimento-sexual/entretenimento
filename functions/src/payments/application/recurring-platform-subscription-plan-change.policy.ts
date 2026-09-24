// functions/src/payments/application/recurring-platform-subscription-plan-change.policy.ts
// -----------------------------------------------------------------------------
// RECURRING PLAN CHANGE SETTLEMENT POLICY
// -----------------------------------------------------------------------------
// Decide qual preço/plano uma cobrança recorrente representa sem tocar em I/O.
// -----------------------------------------------------------------------------

import type {
  PlatformRecurringPendingPlanChange,
} from '../domain/platform-recurring-subscription.model';

export type RecurringPlanSettlementDecision =
  | {
    kind: 'current_plan';
    allowed: true;
    retryAt: null;
    reason: null;
  }
  | {
    kind: 'scheduled_downgrade';
    allowed: true;
    retryAt: null;
    reason: null;
  }
  | {
    kind: 'retry';
    allowed: false;
    retryAt: number;
    reason: 'scheduled_downgrade_effective_period_pending';
  }
  | {
    kind: 'denied';
    allowed: false;
    retryAt: null;
    reason:
      | 'recurring_amount_mismatch'
      | 'recurring_scheduled_amount_mismatch';
  };

export function resolveRecurringPlanSettlementDecision(input: {
  currentAmountCents: number;
  pendingPlanChange: PlatformRecurringPendingPlanChange | null;
  paymentAmountCents: number;
  paymentOccurredAt: number;
  processingNow: number;
}): RecurringPlanSettlementDecision {
  const pending =
    input.pendingPlanChange?.providerUpdateStatus === 'applied'
      ? input.pendingPlanChange
      : null;
  const matchesPending =
    pending !== null
    && input.paymentAmountCents === pending.amountCents;
  const matchesCurrent =
    input.paymentAmountCents === input.currentAmountCents;

  if (!matchesPending && !matchesCurrent) {
    return {
      kind: 'denied',
      allowed: false,
      retryAt: null,
      reason: 'recurring_amount_mismatch',
    };
  }

  if (
    pending
    && matchesCurrent
    && input.paymentOccurredAt >= pending.effectiveAt
  ) {
    return {
      kind: 'denied',
      allowed: false,
      retryAt: null,
      reason: 'recurring_scheduled_amount_mismatch',
    };
  }

  if (
    pending
    && matchesPending
    && input.processingNow < pending.effectiveAt
  ) {
    return {
      kind: 'retry',
      allowed: false,
      retryAt: pending.effectiveAt,
      reason: 'scheduled_downgrade_effective_period_pending',
    };
  }

  if (pending && matchesPending) {
    return {
      kind: 'scheduled_downgrade',
      allowed: true,
      retryAt: null,
      reason: null,
    };
  }

  return {
    kind: 'current_plan',
    allowed: true,
    retryAt: null,
    reason: null,
  };
}

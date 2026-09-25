import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  PlatformRecurringPendingPlanChange,
} from '../domain/platform-recurring-subscription.model';
import {
  resolveRecurringPlanSettlementDecision,
} from './recurring-platform-subscription-plan-change.policy';

const effectiveAt = Date.UTC(2026, 9, 24, 12, 0, 0);

const pending: PlatformRecurringPendingPlanChange = {
  planId: 'platform_basic_monthly',
  planKey: 'basic',
  grantedRole: 'basic',
  planSnapshot: {
    id: 'platform_basic_monthly',
    key: 'basic',
    scope: 'platform_subscription',
    title: 'Plano Básico',
    description: 'Plano mensal',
    amountCents: 1999,
    currency: 'BRL',
    interval: 'month',
    active: true,
    grantedRole: 'basic',
    catalogVersion: 2,
    snapshotAt: effectiveAt - 1_000,
  },
  amountCents: 1999,
  currency: 'BRL',
  effectiveAt,
  requestedAt: effectiveAt - 10_000,
  providerUpdateStatus: 'applied',
  providerUpdateAttemptCount: 0,
  providerUpdateNextAttemptAt: null,
  providerUpdateLastErrorCode: null,
  providerUpdatedAt: effectiveAt - 5_000,
};

test('aceita cobrança do plano atual antes da virada do downgrade', () => {
  assert.deepEqual(
    resolveRecurringPlanSettlementDecision({
      currentAmountCents: 3999,
      pendingPlanChange: pending,
      paymentAmountCents: 3999,
      paymentOccurredAt: effectiveAt - 1,
      processingNow: effectiveAt - 1,
    }),
    {
      kind: 'current_plan',
      allowed: true,
      retryAt: null,
      reason: null,
    }
  );
});

test('não aceita preço antigo para cobrança ocorrida depois da virada', () => {
  const decision = resolveRecurringPlanSettlementDecision({
    currentAmountCents: 3999,
    pendingPlanChange: pending,
    paymentAmountCents: 3999,
    paymentOccurredAt: effectiveAt,
    processingNow: effectiveAt,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'recurring_scheduled_amount_mismatch');
});

test('segura cobrança do plano menor até o benefício atual terminar', () => {
  const decision = resolveRecurringPlanSettlementDecision({
    currentAmountCents: 3999,
    pendingPlanChange: pending,
    paymentAmountCents: 1999,
    paymentOccurredAt: effectiveAt - 60_000,
    processingNow: effectiveAt - 30_000,
  });

  assert.equal(decision.kind, 'retry');
  assert.equal(decision.retryAt, effectiveAt);
});

test('liquida o downgrade somente após a virada efetiva', () => {
  const decision = resolveRecurringPlanSettlementDecision({
    currentAmountCents: 3999,
    pendingPlanChange: pending,
    paymentAmountCents: 1999,
    paymentOccurredAt: effectiveAt - 60_000,
    processingNow: effectiveAt,
  });

  assert.equal(decision.kind, 'scheduled_downgrade');
  assert.equal(decision.allowed, true);
});

test('rejeita qualquer terceiro valor', () => {
  const decision = resolveRecurringPlanSettlementDecision({
    currentAmountCents: 3999,
    pendingPlanChange: pending,
    paymentAmountCents: 2999,
    paymentOccurredAt: effectiveAt,
    processingNow: effectiveAt,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'recurring_amount_mismatch');
});


test('segura cobrança reduzida enquanto cancelamento converge antes da virada', () => {
  const decision = resolveRecurringPlanSettlementDecision({
    currentAmountCents: 3999,
    pendingPlanChange: {
      ...pending,
      cancellationRequestedAt: effectiveAt - 120_000,
      providerRevertNextAttemptAt: effectiveAt + 60_000,
    },
    paymentAmountCents: 1999,
    paymentOccurredAt: effectiveAt - 60_000,
    processingNow: effectiveAt - 30_000,
  });

  assert.equal(decision.kind, 'retry');
  assert.equal(decision.retryAt, effectiveAt);
});

test('liquida o plano menor se o cancelamento não convergiu até a virada', () => {
  const decision = resolveRecurringPlanSettlementDecision({
    currentAmountCents: 3999,
    pendingPlanChange: {
      ...pending,
      cancellationRequestedAt: effectiveAt - 120_000,
    },
    paymentAmountCents: 1999,
    paymentOccurredAt: effectiveAt,
    processingNow: effectiveAt,
  });

  assert.equal(decision.kind, 'scheduled_downgrade');
  assert.equal(decision.allowed, true);
});

test('aceita preço atual quando cancelamento do downgrade já foi solicitado', () => {
  const decision = resolveRecurringPlanSettlementDecision({
    currentAmountCents: 3999,
    pendingPlanChange: {
      ...pending,
      cancellationRequestedAt: effectiveAt - 120_000,
    },
    paymentAmountCents: 3999,
    paymentOccurredAt: effectiveAt,
    processingNow: effectiveAt,
  });

  assert.equal(decision.kind, 'current_plan');
  assert.equal(decision.allowed, true);
});

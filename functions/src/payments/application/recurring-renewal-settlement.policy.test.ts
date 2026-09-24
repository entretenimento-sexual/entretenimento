import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRecurringRenewalAfterPayment,
} from './recurring-renewal-settlement.policy';

function contract(overrides: Partial<{
  status:
    | 'pending_payment'
    | 'active'
    | 'past_due'
    | 'payment_failed'
    | 'canceled'
    | 'deleted'
    | 'superseded'
    | 'chargeback';
  renewalEnabled: boolean;
  needsProviderCancellation: boolean;
  providerCancellationNextAttemptAt: number | null;
  providerCancellationLastErrorCode: string | null;
}> = {}) {
  return {
    status: 'active' as const,
    renewalEnabled: true,
    needsProviderCancellation: false,
    providerCancellationNextAttemptAt: null,
    providerCancellationLastErrorCode: null,
    ...overrides,
  };
}

test('ativação inicial liga renovação e limpa cancelamento pendente', () => {
  const decision = resolveRecurringRenewalAfterPayment({
    contract: contract({
      status: 'pending_payment',
      renewalEnabled: false,
      needsProviderCancellation: true,
      providerCancellationNextAttemptAt: 123,
      providerCancellationLastErrorCode: 'x',
    }),
    activatingNewContract: true,
  });

  assert.equal(decision.status, 'active');
  assert.equal(decision.renewalEnabled, true);
  assert.equal(decision.needsProviderCancellation, false);
  assert.equal(decision.providerCancellationNextAttemptAt, null);
  assert.equal(decision.preservedCancellationIntent, false);
});

test('renovação normal permanece ativa', () => {
  const decision = resolveRecurringRenewalAfterPayment({
    contract: contract(),
    activatingNewContract: false,
  });

  assert.equal(decision.status, 'active');
  assert.equal(decision.renewalEnabled, true);
  assert.equal(decision.needsProviderCancellation, false);
  assert.equal(decision.preservedCancellationIntent, false);
});

test('pagamento após pedido de cancelamento não reativa renovação', () => {
  const decision = resolveRecurringRenewalAfterPayment({
    contract: contract({
      renewalEnabled: false,
      needsProviderCancellation: true,
      providerCancellationNextAttemptAt: 5_000,
      providerCancellationLastErrorCode: 'unavailable',
    }),
    activatingNewContract: false,
  });

  assert.equal(decision.status, 'active');
  assert.equal(decision.renewalEnabled, false);
  assert.equal(decision.needsProviderCancellation, true);
  assert.equal(decision.providerCancellationNextAttemptAt, 5_000);
  assert.equal(decision.providerCancellationLastErrorCode, 'unavailable');
  assert.equal(decision.preservedCancellationIntent, true);
});

test('pagamento tardio após cancelamento já convergido mantém renovação desligada', () => {
  const decision = resolveRecurringRenewalAfterPayment({
    contract: contract({
      status: 'canceled',
      renewalEnabled: false,
      needsProviderCancellation: false,
    }),
    activatingNewContract: false,
  });

  assert.equal(decision.status, 'canceled');
  assert.equal(decision.renewalEnabled, false);
  assert.equal(decision.needsProviderCancellation, false);
  assert.equal(decision.preservedCancellationIntent, true);
});

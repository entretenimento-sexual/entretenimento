import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateRecurringSubscriptionAmountIntegrity,
} from './recurring-subscription-integrity.policy';

test('confirma valor recorrente idêntico ao contrato', () => {
  assert.equal(
    evaluateRecurringSubscriptionAmountIntegrity({
      contractAmountCents: 2_999,
      providerAmountCents: 2_999,
    }),
    'verified'
  );
});

test('aceita evento de assinatura sem valor apenas como não verificável', () => {
  assert.equal(
    evaluateRecurringSubscriptionAmountIntegrity({
      contractAmountCents: 2_999,
      providerAmountCents: null,
    }),
    'unavailable'
  );
});

test('detecta divergência financeira do provider', () => {
  assert.equal(
    evaluateRecurringSubscriptionAmountIntegrity({
      contractAmountCents: 2_999,
      providerAmountCents: 3_999,
    }),
    'mismatch'
  );
});

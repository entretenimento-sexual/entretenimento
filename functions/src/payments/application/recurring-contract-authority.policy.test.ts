import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRecurringContractBuyer,
} from './recurring-contract-authority.policy';

test('aceita contrato pertencente ao comprador esperado', () => {
  assert.doesNotThrow(() =>
    assertRecurringContractBuyer('user-1', 'user-1')
  );
});

test('rejeita ponteiro recorrente para outro comprador', () => {
  assert.throws(
    () => assertRecurringContractBuyer('user-2', 'user-1'),
    (error: unknown) => {
      const source = error as {
        code?: unknown;
        details?: Record<string, unknown>;
      };
      assert.equal(source.code, 'data-loss');
      assert.equal(
        source.details?.['reason'],
        'recurring_contract_buyer_mismatch'
      );
      return true;
    }
  );
});

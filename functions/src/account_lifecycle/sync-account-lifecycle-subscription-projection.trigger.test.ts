import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldReconcileSubscriptionAfterLifecycleTransition,
} from './sync-account-lifecycle-subscription-projection.trigger';

test('reconcilia billing quando lifecycle volta a active', () => {
  assert.equal(
    shouldReconcileSubscriptionAfterLifecycleTransition({
      beforeStatus: 'moderation_suspended',
      afterStatus: 'active',
    }),
    true
  );
  assert.equal(
    shouldReconcileSubscriptionAfterLifecycleTransition({
      beforeStatus: 'self_suspended',
      afterStatus: 'active',
    }),
    true
  );
  assert.equal(
    shouldReconcileSubscriptionAfterLifecycleTransition({
      beforeStatus: 'pending_deletion',
      afterStatus: 'active',
    }),
    true
  );
});

test('não cria loop para writes enquanto a conta já está active', () => {
  assert.equal(
    shouldReconcileSubscriptionAfterLifecycleTransition({
      beforeStatus: 'active',
      afterStatus: 'active',
    }),
    false
  );
});

test('não reconcilia projeção financeira ao entrar em estado restrito', () => {
  assert.equal(
    shouldReconcileSubscriptionAfterLifecycleTransition({
      beforeStatus: 'active',
      afterStatus: 'moderation_suspended',
    }),
    false
  );
});

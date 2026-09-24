import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolvePlatformSubscriptionPlanChangePolicy,
  shouldBlockDuplicateRecurringCheckout,
} from './platform-subscription-change.policy';

test('bloqueia checkout duplicado do mesmo plano com renovação ativa', () => {
  assert.equal(
    shouldBlockDuplicateRecurringCheckout({
      currentRole: 'premium',
      requestedRole: 'premium',
      recurringPlanKey: 'premium',
      renewalEnabled: true,
    }),
    true
  );
});

test('não bloqueia nova contratação do mesmo plano após desligar renovação', () => {
  assert.equal(
    shouldBlockDuplicateRecurringCheckout({
      currentRole: 'premium',
      requestedRole: 'premium',
      recurringPlanKey: 'premium',
      renewalEnabled: false,
    }),
    false
  );
});

test('permite nova assinatura quando não há plano ativo', () => {
  const policy = resolvePlatformSubscriptionPlanChangePolicy({
    currentRole: null,
    requestedRole: 'basic',
  });

  assert.equal(policy.allowed, true);
  assert.equal(policy.kind, 'new_subscription');
  assert.equal(policy.priceTreatment, 'current_catalog_snapshot_full_period');
  assert.equal(policy.periodTreatment, 'start_from_payment');
  assert.equal(policy.accessTreatment, 'activate_after_payment');
  assert.equal(policy.prorationSupported, false);
});

test('permite upgrade imediato', () => {
  const policy = resolvePlatformSubscriptionPlanChangePolicy({
    currentRole: 'basic',
    requestedRole: 'premium',
  });

  assert.equal(policy.allowed, true);
  assert.equal(policy.kind, 'upgrade');
  assert.equal(policy.priceTreatment, 'current_catalog_snapshot_full_period');
  assert.equal(policy.periodTreatment, 'extend_from_current_end');
  assert.equal(policy.accessTreatment, 'upgrade_after_payment');
  assert.equal(policy.prorationSupported, false);
});

test('permite renovação do mesmo plano no backend', () => {
  const policy = resolvePlatformSubscriptionPlanChangePolicy({
    currentRole: 'vip',
    requestedRole: 'vip',
  });

  assert.equal(policy.allowed, true);
  assert.equal(policy.kind, 'renewal');
  assert.equal(policy.periodTreatment, 'extend_from_current_end');
  assert.equal(policy.accessTreatment, 'preserve_current_access');
});

test('bloqueia downgrade até existir agendamento para o próximo ciclo', () => {
  const policy = resolvePlatformSubscriptionPlanChangePolicy({
    currentRole: 'vip',
    requestedRole: 'basic',
  });

  assert.equal(policy.allowed, false);
  assert.equal(policy.kind, 'downgrade_blocked');
  assert.equal(policy.priceTreatment, 'not_available');
  assert.equal(policy.periodTreatment, 'blocked');
  assert.equal(policy.accessTreatment, 'blocked');
});

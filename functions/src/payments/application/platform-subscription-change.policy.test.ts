import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolvePlatformSubscriptionPlanChangePolicy,
} from './platform-subscription-change.policy';

test('permite nova assinatura quando não há plano ativo', () => {
  const policy = resolvePlatformSubscriptionPlanChangePolicy({
    currentRole: null,
    requestedRole: 'basic',
  });

  assert.equal(policy.allowed, true);
  assert.equal(policy.kind, 'new_subscription');
});

test('permite upgrade imediato', () => {
  const policy = resolvePlatformSubscriptionPlanChangePolicy({
    currentRole: 'basic',
    requestedRole: 'premium',
  });

  assert.equal(policy.allowed, true);
  assert.equal(policy.kind, 'upgrade');
});

test('permite renovação do mesmo plano no backend', () => {
  const policy = resolvePlatformSubscriptionPlanChangePolicy({
    currentRole: 'vip',
    requestedRole: 'vip',
  });

  assert.equal(policy.allowed, true);
  assert.equal(policy.kind, 'renewal');
});

test('bloqueia downgrade até existir agendamento para o próximo ciclo', () => {
  const policy = resolvePlatformSubscriptionPlanChangePolicy({
    currentRole: 'vip',
    requestedRole: 'basic',
  });

  assert.equal(policy.allowed, false);
  assert.equal(policy.kind, 'downgrade_blocked');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePlatformSubscriptionEntitlement,
  hasMinimumPlatformRole,
} from './platform-subscription-entitlement.service';

const NOW = 1_800_000_000_000;

function createEntitlement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'platform_subscription_user-1',
    buyerUid: 'user-1',
    sellerUid: null,
    scope: 'platform_subscription',
    planId: 'premium-monthly',
    planKey: 'premium',
    grantedRole: 'premium',
    active: true,
    startsAt: NOW - 60_000,
    endsAt: NOW + 60_000,
    sourceCheckoutSessionId: 'checkout-1',
    sourcePaymentTransactionId: 'transaction-1',
    createdAt: NOW - 60_000,
    updatedAt: NOW - 30_000,
    ...overrides,
  };
}

test('aceita entitlement ativo, vigente e vinculado ao usuário', () => {
  const result = evaluatePlatformSubscriptionEntitlement(
    createEntitlement(),
    'user-1',
    NOW
  );

  assert.equal(result.active, true);
  assert.equal(result.role, 'premium');
  assert.equal(result.endsAt, NOW + 60_000);
});

test('nega entitlement expirado', () => {
  const result = evaluatePlatformSubscriptionEntitlement(
    createEntitlement({ endsAt: NOW }),
    'user-1',
    NOW
  );

  assert.equal(result.active, false);
  assert.equal(result.role, null);
});

test('nega entitlement que ainda não começou', () => {
  const result = evaluatePlatformSubscriptionEntitlement(
    createEntitlement({ startsAt: NOW + 1 }),
    'user-1',
    NOW
  );

  assert.equal(result.active, false);
});

test('nega entitlement associado a outro usuário', () => {
  const result = evaluatePlatformSubscriptionEntitlement(
    createEntitlement({ buyerUid: 'user-2' }),
    'user-1',
    NOW
  );

  assert.equal(result.active, false);
});

test('nega role desconhecida ou janela temporal inválida', () => {
  const unknownRole = evaluatePlatformSubscriptionEntitlement(
    createEntitlement({ grantedRole: 'gold' }),
    'user-1',
    NOW
  );
  const invalidEndsAt = evaluatePlatformSubscriptionEntitlement(
    createEntitlement({ endsAt: 'amanhã' }),
    'user-1',
    NOW
  );

  assert.equal(unknownRole.active, false);
  assert.equal(invalidEndsAt.active, false);
});

test('aplica a hierarquia de planos sem promover níveis inferiores', () => {
  assert.equal(hasMinimumPlatformRole('vip', 'premium'), true);
  assert.equal(hasMinimumPlatformRole('premium', 'premium'), true);
  assert.equal(hasMinimumPlatformRole('basic', 'premium'), false);
  assert.equal(hasMinimumPlatformRole(null, 'basic'), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculatePlatformSubscriptionPeriodEnd,
  evaluatePlatformSubscriptionEntitlement,
  hasMinimumPlatformRole,
  resolvePlatformSubscriptionSettlementPeriod,
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
  assert.equal(result.legacyEndsAtDerived, false);
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

test('deriva fim mensal finito para entitlement legado sem endsAt', () => {
  const startsAt = Date.UTC(2026, 0, 15, 12, 30, 0);
  const expectedEndsAt = Date.UTC(2026, 1, 15, 12, 30, 0);

  const result = evaluatePlatformSubscriptionEntitlement(
    createEntitlement({ startsAt, endsAt: null }),
    'user-1',
    startsAt + 1
  );

  assert.equal(result.active, true);
  assert.equal(result.endsAt, expectedEndsAt);
  assert.equal(result.legacyEndsAtDerived, true);
});

test('limita o dia ao último dia do mês na renovação civil', () => {
  const january31 = Date.UTC(2026, 0, 31, 10, 0, 0);
  const expectedFebruary28 = Date.UTC(2026, 1, 28, 10, 0, 0);

  assert.equal(
    calculatePlatformSubscriptionPeriodEnd(january31),
    expectedFebruary28
  );
});

test('não transforma entitlement legado já vencido em acesso ativo', () => {
  const startsAt = Date.UTC(2025, 0, 1);
  const result = evaluatePlatformSubscriptionEntitlement(
    createEntitlement({ startsAt, endsAt: null }),
    'user-1',
    Date.UTC(2026, 0, 1)
  );

  assert.equal(result.active, false);
  assert.equal(result.legacyEndsAtDerived, true);
});

test('renovação vigente estende a partir do término atual', () => {
  const currentEndsAt = Date.UTC(2026, 7, 20, 15, 0, 0);
  const expectedEndsAt = Date.UTC(2026, 8, 20, 15, 0, 0);
  const startsAt = Date.UTC(2026, 6, 20, 15, 0, 0);

  const period = resolvePlatformSubscriptionSettlementPeriod(
    createEntitlement({ startsAt, endsAt: currentEndsAt }),
    'user-1',
    Date.UTC(2026, 7, 1)
  );

  assert.equal(period.startsAt, startsAt);
  assert.equal(period.extensionBase, currentEndsAt);
  assert.equal(period.endsAt, expectedEndsAt);
  assert.equal(period.extendedExistingAccess, true);
});

test('renovação legado vigente preserva o fim mensal derivado', () => {
  const startsAt = Date.UTC(2026, 6, 20, 15, 0, 0);
  const derivedEndsAt = Date.UTC(2026, 7, 20, 15, 0, 0);
  const expectedRenewedEndsAt = Date.UTC(2026, 8, 20, 15, 0, 0);

  const period = resolvePlatformSubscriptionSettlementPeriod(
    createEntitlement({ startsAt, endsAt: null }),
    'user-1',
    Date.UTC(2026, 7, 1)
  );

  assert.equal(period.startsAt, startsAt);
  assert.equal(period.extensionBase, derivedEndsAt);
  assert.equal(period.endsAt, expectedRenewedEndsAt);
  assert.equal(period.extendedExistingAccess, true);
});

test('reativação vencida inicia novo período em now', () => {
  const now = Date.UTC(2026, 7, 20, 15, 0, 0);
  const expectedEndsAt = Date.UTC(2026, 8, 20, 15, 0, 0);

  const period = resolvePlatformSubscriptionSettlementPeriod(
    createEntitlement({
      startsAt: Date.UTC(2025, 0, 1),
      endsAt: Date.UTC(2025, 1, 1),
    }),
    'user-1',
    now
  );

  assert.equal(period.startsAt, now);
  assert.equal(period.extensionBase, now);
  assert.equal(period.endsAt, expectedEndsAt);
  assert.equal(period.extendedExistingAccess, false);
});

test('aplica a hierarquia de planos sem promover níveis inferiores', () => {
  assert.equal(hasMinimumPlatformRole('vip', 'premium'), true);
  assert.equal(hasMinimumPlatformRole('premium', 'premium'), true);
  assert.equal(hasMinimumPlatformRole('basic', 'premium'), false);
  assert.equal(hasMinimumPlatformRole(null, 'basic'), false);
});

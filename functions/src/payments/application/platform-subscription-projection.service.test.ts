import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlatformSubscriptionUserProjection,
} from './platform-subscription-projection.service';

const NOW = 1_800_000_000_000;

test('projeta acesso ativo e aliases coerentes', () => {
  const projection = buildPlatformSubscriptionUserProjection(
    {
      active: true,
      role: 'premium',
      startsAt: NOW - 1_000,
      endsAt: NOW + 1_000,
      updatedAt: NOW,
      legacyEndsAtDerived: false,
    },
    'free',
    NOW
  );

  assert.equal(projection.role, 'premium');
  assert.equal(projection.tier, 'premium');
  assert.equal(projection.isSubscriber, true);
  assert.equal(projection.monthlyPayer, true);
  assert.equal(projection.subscriptionStatus, 'active');
  assert.equal(projection.subscriptionEndsAt?.toMillis(), NOW + 1_000);
  assert.equal(projection.subscriptionExpires?.toMillis(), NOW + 1_000);
});

test('revoga projeção paga quando entitlement está inativo', () => {
  const projection = buildPlatformSubscriptionUserProjection(
    {
      active: false,
      role: null,
      startsAt: NOW - 2_000,
      endsAt: NOW - 1_000,
      updatedAt: NOW,
      legacyEndsAtDerived: false,
    },
    'vip',
    NOW
  );

  assert.equal(projection.role, 'free');
  assert.equal(projection.tier, 'free');
  assert.equal(projection.isSubscriber, false);
  assert.equal(projection.monthlyPayer, false);
  assert.equal(projection.subscriptionStatus, 'inactive');
  assert.equal(projection.subscriptionScope, null);
});

test('preserva role administrativo sem confundi-lo com plano', () => {
  const projection = buildPlatformSubscriptionUserProjection(
    {
      active: true,
      role: 'vip',
      startsAt: NOW - 1_000,
      endsAt: NOW + 1_000,
      updatedAt: NOW,
      legacyEndsAtDerived: false,
    },
    'admin',
    NOW
  );

  assert.equal(projection.role, 'admin');
  assert.equal(projection.tier, 'vip');
});

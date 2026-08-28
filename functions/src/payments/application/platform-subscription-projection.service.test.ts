import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlatformSubscriptionUserProjection,
  platformSubscriptionPublicProjectionMatches,
  platformSubscriptionUserProjectionMatches,
} from './platform-subscription-projection.service';

const NOW = 1_800_000_000_000;

function activeProjection() {
  return buildPlatformSubscriptionUserProjection(
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
}

test('projeta acesso ativo e aliases coerentes', () => {
  const projection = activeProjection();

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

test('considera projeção equivalente mesmo com billingUpdatedAt antigo', () => {
  const projection = activeProjection();
  const current = {
    ...projection,
    billingUpdatedAt: NOW - 60_000,
  };

  assert.equal(
    platformSubscriptionUserProjectionMatches(current, projection),
    true
  );
});

test('detecta mudança de término ou flag operacional', () => {
  const projection = activeProjection();

  assert.equal(
    platformSubscriptionUserProjectionMatches(
      {
        ...projection,
        subscriptionEndsAt: null,
      },
      projection
    ),
    false
  );
  assert.equal(
    platformSubscriptionUserProjectionMatches(
      {
        ...projection,
        isSubscriber: false,
      },
      projection
    ),
    false
  );
});

test('projeção pública exige role e versão canônica', () => {
  assert.equal(
    platformSubscriptionPublicProjectionMatches(
      { role: 'premium', billingProjectionVersion: 1 },
      'premium'
    ),
    true
  );
  assert.equal(
    platformSubscriptionPublicProjectionMatches(
      { role: 'premium', billingProjectionVersion: 0 },
      'premium'
    ),
    false
  );
});

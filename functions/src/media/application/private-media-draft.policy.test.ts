import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPrivateMediaDraftReservation,
  calculatePrivateMediaDraftExpiry,
  calculatePrivateMediaDraftReservationBytes,
  evaluatePrivateMediaDraftCapacity,
  getPrivateMediaDraftLimit,
  releasePrivateMediaDraftReservation,
  resolvePrivateMediaDraftPlan,
} from './private-media-draft.policy';

function activeSubscriber(
  plan: 'basic' | 'premium' | 'vip',
  now = 1_000_000
): Record<string, unknown> {
  return {
    role: plan,
    tier: plan,
    billingProjectionVersion: 1,
    isSubscriber: true,
    subscriptionStatus: 'active',
    subscriptionScope: 'platform_subscription',
    subscriptionStartedAt: now - 1_000,
    subscriptionEndsAt: now + 1_000,
  };
}

test('resolve plano somente com projeção financeira ativa e vigente', () => {
  const now = 1_000_000;

  assert.equal(resolvePrivateMediaDraftPlan(activeSubscriber('basic', now), now), 'basic');
  assert.equal(resolvePrivateMediaDraftPlan(activeSubscriber('premium', now), now), 'premium');
  assert.equal(resolvePrivateMediaDraftPlan(activeSubscriber('vip', now), now), 'vip');
  assert.equal(resolvePrivateMediaDraftPlan({ role: 'admin' }, now), 'vip');
  assert.equal(
    resolvePrivateMediaDraftPlan(
      {
        ...activeSubscriber('premium', now),
        billingProjectionVersion: 0,
      },
      now
    ),
    'free'
  );
  assert.equal(
    resolvePrivateMediaDraftPlan(
      {
        ...activeSubscriber('vip', now),
        subscriptionEndsAt: now,
      },
      now
    ),
    'free'
  );
});

test('aplica 72 horas ao gratuito e sete dias aos assinantes', () => {
  const now = 5_000;
  const freeLimit = getPrivateMediaDraftLimit('video', 'free');
  const paidLimit = getPrivateMediaDraftLimit('video', 'premium');

  assert.equal(
    calculatePrivateMediaDraftExpiry('video', 'free', now),
    now + freeLimit.retentionMs
  );
  assert.equal(
    calculatePrivateMediaDraftExpiry('photo', 'premium', now),
    now + paidLimit.retentionMs
  );
  assert.equal(freeLimit.retentionMs, 72 * 60 * 60 * 1000);
  assert.equal(paidLimit.retentionMs, 7 * 24 * 60 * 60 * 1000);
});

test('reserva margem para original e derivado de vídeo', () => {
  assert.equal(
    calculatePrivateMediaDraftReservationBytes('video', 100, 10),
    210
  );
  assert.equal(
    calculatePrivateMediaDraftReservationBytes('photo', 100, 10),
    110
  );
});

test('bloqueia por quantidade antes de aceitar novo rascunho', () => {
  const limit = getPrivateMediaDraftLimit('video', 'free');
  const decision = evaluatePrivateMediaDraftCapacity(
    'video',
    'free',
    {
      videoCount: limit.maxItems,
      videoReservedBytes: 1,
    },
    1
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'ITEM_LIMIT');
});

test('bloqueia por volume reservado', () => {
  const limit = getPrivateMediaDraftLimit('photo', 'basic');
  const decision = evaluatePrivateMediaDraftCapacity(
    'photo',
    'basic',
    {
      photoCount: 0,
      photoReservedBytes: limit.maxReservedBytes,
    },
    1
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'BYTE_LIMIT');
});

test('reserva e libera contadores sem permitir valores negativos', () => {
  const reserved = applyPrivateMediaDraftReservation(
    'video',
    {},
    500
  );

  assert.deepEqual(reserved, {
    photoCount: 0,
    photoReservedBytes: 0,
    videoCount: 1,
    videoReservedBytes: 500,
  });

  assert.deepEqual(
    releasePrivateMediaDraftReservation('video', reserved, 700),
    {
      photoCount: 0,
      photoReservedBytes: 0,
      videoCount: 0,
      videoReservedBytes: 0,
    }
  );
});

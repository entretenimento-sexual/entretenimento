import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasPublicVideoPlaybackPlan,
  normalizePublicVideoMinimumPlaybackPlan,
} from './public-video-playback-plan.policy';

function subscribedUser(
  role: 'basic' | 'premium' | 'vip',
  now = 1_000_000
): Record<string, unknown> {
  return {
    uid: 'viewer-1',
    role,
    tier: role,
    billingProjectionVersion: 1,
    isSubscriber: true,
    subscriptionStatus: 'active',
    subscriptionScope: 'platform_subscription',
    subscriptionStartedAt: now - 10_000,
    subscriptionEndsAt: now + 10_000,
  };
}

test('normaliza exigências desconhecidas para acesso gratuito', () => {
  assert.equal(normalizePublicVideoMinimumPlaybackPlan(undefined), 'free');
  assert.equal(normalizePublicVideoMinimumPlaybackPlan('PUBLIC'), 'free');
  assert.equal(normalizePublicVideoMinimumPlaybackPlan('PREMIUM'), 'premium');
});

test('permite qualquer conta elegível quando o vídeo é gratuito', () => {
  assert.equal(hasPublicVideoPlaybackPlan({}, 'free'), true);
});

test('exige projeção financeira ativa para basic ou superior', () => {
  const now = 1_000_000;

  assert.equal(
    hasPublicVideoPlaybackPlan(subscribedUser('basic', now), 'basic', now),
    true
  );
  assert.equal(
    hasPublicVideoPlaybackPlan(subscribedUser('basic', now), 'premium', now),
    false
  );
  assert.equal(
    hasPublicVideoPlaybackPlan(subscribedUser('premium', now), 'basic', now),
    true
  );
});

test('nega role decorativa sem entitlement ativo', () => {
  assert.equal(
    hasPublicVideoPlaybackPlan(
      {
        role: 'premium',
        tier: 'premium',
        billingProjectionVersion: 1,
        isSubscriber: false,
        subscriptionStatus: 'inactive',
      },
      'basic',
      1_000_000
    ),
    false
  );
});

test('permite administrador sem assinatura financeira', () => {
  assert.equal(hasPublicVideoPlaybackPlan({ role: 'admin' }, 'vip'), true);
});

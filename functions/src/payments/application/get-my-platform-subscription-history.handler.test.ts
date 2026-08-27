import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sanitizePlatformSubscriptionHistoryItem,
  toPublicSubscriptionHistoryCursor,
} from './get-my-platform-subscription-history.handler';

test('sanitiza transição sem expor ids financeiros internos', () => {
  const item = sanitizePlatformSubscriptionHistoryItem('event-public-1', {
    action: 'platform_subscription_transition',
    eventType: 'subscription_upgraded',
    buyerUid: 'private-user',
    entitlementId: 'platform_subscription_private-user',
    sourceCheckoutSessionId: 'checkout-secret',
    sourcePaymentTransactionId: 'transaction-secret',
    source: 'payment_settlement',
    reason: 'paid_plan_upgrade',
    occurredAt: 1_800_000_000_000,
    from: {
      active: true,
      role: 'basic',
      planKey: 'basic',
      startsAt: 1_799_000_000_000,
      endsAt: 1_801_000_000_000,
    },
    to: {
      active: true,
      role: 'premium',
      planKey: 'premium',
      startsAt: 1_799_000_000_000,
      endsAt: 1_802_000_000_000,
    },
  });

  assert.ok(item);
  assert.equal(item.id, 'event-public-1');
  assert.equal(item.eventType, 'subscription_upgraded');
  assert.equal(item.from?.role, 'basic');
  assert.equal(item.to?.role, 'premium');
  assert.equal('buyerUid' in item, false);
  assert.equal('entitlementId' in item, false);
  assert.equal('sourceCheckoutSessionId' in item, false);
  assert.equal('sourcePaymentTransactionId' in item, false);
});

test('normaliza snapshot inativo como plano gratuito', () => {
  const item = sanitizePlatformSubscriptionHistoryItem('event-public-2', {
    action: 'platform_subscription_transition',
    eventType: 'subscription_expired',
    source: 'subscription_reconciliation',
    reason: 'period_elapsed',
    occurredAt: 1_800_000_000_000,
    from: {
      active: true,
      role: 'vip',
      planKey: 'vip',
      startsAt: 1_799_000_000_000,
      endsAt: 1_800_000_000_000,
    },
    to: {
      active: false,
      role: null,
      planKey: 'vip',
      startsAt: 1_799_000_000_000,
      endsAt: 1_800_000_000_000,
    },
  });

  assert.ok(item);
  assert.equal(item.from?.role, 'vip');
  assert.equal(item.to?.role, 'free');
});

test('cursor público remove o prefixo vinculado ao usuário', () => {
  const prefix = 'platform_subscription_transition_1234567890abcdef1234_';
  const suffix = '8199999999999_0123456789abcdef01234567';
  const cursor = toPublicSubscriptionHistoryCursor(`${prefix}${suffix}`, prefix);

  assert.equal(cursor, suffix);
  assert.equal(cursor.includes('1234567890abcdef1234'), false);
  assert.equal(cursor.includes('platform_subscription_transition'), false);
});

test('rejeita documentos que não pertencem à trilha de transição', () => {
  assert.equal(
    sanitizePlatformSubscriptionHistoryItem('event-public-3', {
      action: 'settle_paid_event',
      occurredAt: 1_800_000_000_000,
    }),
    null
  );
});

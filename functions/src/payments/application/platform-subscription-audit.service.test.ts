import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPlatformSubscriptionAuditSnapshot,
  buildPlatformSubscriptionTransitionAuditId,
  buildPlatformSubscriptionTransitionAuditRecord,
  resolvePlatformSubscriptionTransitionType,
} from './platform-subscription-audit.service';

const NOW = 1_800_000_000_000;

function active(role: 'basic' | 'premium' | 'vip', endsAt = NOW + 86_400_000) {
  return {
    buyerUid: 'user-1',
    scope: 'platform_subscription',
    planKey: role,
    grantedRole: role,
    active: true,
    startsAt: NOW - 1_000,
    endsAt,
    sourceCheckoutSessionId: `checkout-${role}`,
    sourcePaymentTransactionId: `tx-${role}`,
    updatedAt: NOW,
  };
}

test('classifica início de assinatura', () => {
  const after = buildPlatformSubscriptionAuditSnapshot(active('basic'));

  assert.equal(
    resolvePlatformSubscriptionTransitionType({
      before: null,
      after,
      occurredAt: NOW,
    }),
    'subscription_started'
  );
});

test('classifica upgrade e downgrade pelo papel financeiro', () => {
  const basic = buildPlatformSubscriptionAuditSnapshot(active('basic'));
  const premium = buildPlatformSubscriptionAuditSnapshot(active('premium'));

  assert.equal(
    resolvePlatformSubscriptionTransitionType({
      before: basic,
      after: premium,
      occurredAt: NOW,
    }),
    'subscription_upgraded'
  );

  assert.equal(
    resolvePlatformSubscriptionTransitionType({
      before: premium,
      after: basic,
      occurredAt: NOW,
    }),
    'subscription_downgraded'
  );
});

test('classifica renovação quando o período aumenta sem trocar o plano', () => {
  const before = buildPlatformSubscriptionAuditSnapshot(
    active('basic', NOW + 10_000)
  );
  const after = buildPlatformSubscriptionAuditSnapshot(
    active('basic', NOW + 20_000)
  );

  assert.equal(
    resolvePlatformSubscriptionTransitionType({ before, after, occurredAt: NOW }),
    'subscription_renewed'
  );
});

test('distingue expiração de desativação antecipada', () => {
  const expiredBefore = buildPlatformSubscriptionAuditSnapshot(
    active('premium', NOW - 1)
  );
  const futureBefore = buildPlatformSubscriptionAuditSnapshot(
    active('premium', NOW + 60_000)
  );
  const inactive = buildPlatformSubscriptionAuditSnapshot({
    ...active('premium'),
    active: false,
    updatedAt: NOW,
  });

  assert.equal(
    resolvePlatformSubscriptionTransitionType({
      before: expiredBefore,
      after: inactive,
      occurredAt: NOW,
    }),
    'subscription_expired'
  );

  assert.equal(
    resolvePlatformSubscriptionTransitionType({
      before: futureBefore,
      after: inactive,
      occurredAt: NOW,
    }),
    'subscription_deactivated'
  );
});

test('não cria evento para escrita sem mudança semântica', () => {
  const snapshot = buildPlatformSubscriptionAuditSnapshot(active('vip'));

  assert.equal(
    resolvePlatformSubscriptionTransitionType({
      before: snapshot,
      after: snapshot,
      occurredAt: NOW,
    }),
    null
  );
});

test('registro pago expõe before/after e fonte sem payload sensível', () => {
  const before = active('basic', NOW + 10_000);
  const after = {
    ...active('premium', NOW + 20_000),
    sourcePaymentTransactionId: 'tx-premium-new',
  };

  const built = buildPlatformSubscriptionTransitionAuditRecord({
    buyerUid: 'user-1',
    entitlementId: 'platform_subscription_user-1',
    eventId: 'event-upgrade-1',
    beforeData: before,
    afterData: after,
    occurredAt: NOW,
    recordedAt: NOW + 1,
  });

  assert.ok(built);
  assert.equal(built.record.eventType, 'subscription_upgraded');
  assert.equal(built.record.source, 'payment_settlement');
  assert.equal(built.record.reason, 'paid_plan_upgrade');
  assert.equal(built.record.from?.role, 'basic');
  assert.equal(built.record.to?.role, 'premium');
  assert.equal(built.record.sourcePaymentTransactionId, 'tx-premium-new');
  assert.equal('providerPayload' in built.record, false);
});

test('id é estável e ordena eventos mais recentes primeiro', () => {
  const newer = buildPlatformSubscriptionTransitionAuditId({
    buyerUid: 'user-1',
    eventId: 'newer',
    occurredAt: NOW + 10_000,
  });
  const older = buildPlatformSubscriptionTransitionAuditId({
    buyerUid: 'user-1',
    eventId: 'older',
    occurredAt: NOW,
  });
  const same = buildPlatformSubscriptionTransitionAuditId({
    buyerUid: 'user-1',
    eventId: 'newer',
    occurredAt: NOW + 10_000,
  });

  assert.equal(newer, same);
  assert.ok(newer < older);
});

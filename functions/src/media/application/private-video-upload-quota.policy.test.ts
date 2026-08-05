import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculatePrivateVideoReservationBytes,
  estimateRegisteredVideoReservedBytes,
  evaluatePrivateVideoQuota,
  getPrivateVideoProductLimit,
  getPrivateVideoQuotaLimit,
  resolvePrivateVideoQuotaPlan,
} from './private-video-upload-quota.policy';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

describe('private-video-upload-quota.policy', () => {
  it('mantém conta sem projeção financeira no plano free', () => {
    assert.equal(
      resolvePrivateVideoQuotaPlan({ role: 'premium' }, 1_000),
      'free'
    );
  });

  it('reconhece projeção paga ativa e vigente', () => {
    assert.equal(
      resolvePrivateVideoQuotaPlan(
        {
          tier: 'premium',
          billingProjectionVersion: 1,
          isSubscriber: true,
          subscriptionStatus: 'active',
          subscriptionScope: 'platform_subscription',
          subscriptionStartedAt: 500,
          subscriptionEndsAt: 2_000,
        },
        1_000
      ),
      'premium'
    );
  });

  it('não reconhece assinatura vencida', () => {
    assert.equal(
      resolvePrivateVideoQuotaPlan(
        {
          tier: 'vip',
          billingProjectionVersion: 1,
          isSubscriber: true,
          subscriptionStatus: 'active',
          subscriptionScope: 'platform_subscription',
          subscriptionStartedAt: 500,
          subscriptionEndsAt: 900,
        },
        1_000
      ),
      'free'
    );
  });

  it('define vídeo social curto e arquivo conservador', () => {
    assert.deepEqual(getPrivateVideoProductLimit(), {
      maxSourceBytes: 80 * MIB,
      maxPosterBytes: 5 * MIB,
      minDurationMs: 5_000,
      maxDurationMs: 60_000,
    });
  });

  it('expõe limites iniciais reduzidos por plano', () => {
    assert.deepEqual(getPrivateVideoQuotaLimit('free'), {
      maxItems: 1,
      maxReservedBytes: 180 * MIB,
    });
    assert.deepEqual(getPrivateVideoQuotaLimit('basic'), {
      maxItems: 3,
      maxReservedBytes: 540 * MIB,
    });
    assert.deepEqual(getPrivateVideoQuotaLimit('premium'), {
      maxItems: 8,
      maxReservedBytes: Math.trunc(1.5 * GIB),
    });
    assert.deepEqual(getPrivateVideoQuotaLimit('vip'), {
      maxItems: 15,
      maxReservedBytes: 3 * GIB,
    });
  });

  it('reserva original, margem do derivado e capa', () => {
    assert.equal(
      calculatePrivateVideoReservationBytes(80 * MIB, 5 * MIB),
      165 * MIB
    );
  });

  it('usa quota persistida quando disponível', () => {
    assert.equal(
      estimateRegisteredVideoReservedBytes({ quotaReservedBytes: 1234 }),
      1234
    );
  });

  it('estima vídeos legados sem quota persistida', () => {
    assert.equal(
      estimateRegisteredVideoReservedBytes({
        sourceSizeBytes: 100,
        processedSizeBytes: 80,
        posterSizeBytes: 5,
      }),
      205
    );
  });

  it('bloqueia quantidade acima do plano', () => {
    const decision = evaluatePrivateVideoQuota(
      'free',
      { currentItems: 1, currentReservedBytes: 100 },
      200
    );

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'ITEM_LIMIT');
    assert.equal(decision.limit.maxItems, 1);
  });

  it('bloqueia volume acima do plano', () => {
    const decision = evaluatePrivateVideoQuota(
      'basic',
      { currentItems: 0, currentReservedBytes: 540 * MIB - 100 },
      200
    );

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'BYTE_LIMIT');
    assert.equal(decision.limit.maxReservedBytes, 540 * MIB);
  });

  it('libera capacidade dentro dos limites', () => {
    const decision = evaluatePrivateVideoQuota(
      'vip',
      { currentItems: 4, currentReservedBytes: 500 * MIB },
      165 * MIB
    );

    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, 'ALLOWED');
    assert.equal(decision.nextItems, 5);
    assert.equal(getPrivateVideoQuotaLimit('vip').maxItems, 15);
  });
});

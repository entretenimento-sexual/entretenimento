import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPrivateVideoUploadCapacityResponse } from './private-video-upload-capacity.handler';

const MIB = 1024 * 1024;

describe('private-video-upload-capacity.handler', () => {
  it('projeta limite atingido antes da seleção do arquivo', () => {
    const response = buildPrivateVideoUploadCapacityResponse({
      user: {},
      videos: [
        {
          id: 'video-1',
          data: { quotaReservedBytes: 100 * MIB },
        },
      ],
      reservations: [],
      now: 1_000,
    });

    assert.equal(response.plan, 'free');
    assert.equal(response.currentItems, 1);
    assert.equal(response.maxItems, 1);
    assert.equal(response.remainingItems, 0);
    assert.equal(response.itemLimitReached, true);
    assert.equal(response.canStartUpload, false);
    assert.equal(response.maxSourceBytes, 80 * MIB);
    assert.equal(response.maxDurationMs, 60_000);
  });

  it('inclui reserva ativa e ignora reserva expirada ou já registrada', () => {
    const response = buildPrivateVideoUploadCapacityResponse({
      user: {
        tier: 'basic',
        billingProjectionVersion: 1,
        isSubscriber: true,
        subscriptionStatus: 'active',
        subscriptionScope: 'platform_subscription',
        subscriptionStartedAt: 100,
        subscriptionEndsAt: 2_000,
      },
      videos: [
        {
          id: 'registered',
          data: { quotaReservedBytes: 50 * MIB },
        },
      ],
      reservations: [
        {
          videoId: 'pending',
          state: 'ACTIVE',
          reservedBytes: 40 * MIB,
          expiresAt: 1_500,
        },
        {
          videoId: 'expired',
          state: 'ACTIVE',
          reservedBytes: 40 * MIB,
          expiresAt: 900,
        },
        {
          videoId: 'registered',
          state: 'ACTIVE',
          reservedBytes: 50 * MIB,
          expiresAt: 1_500,
        },
      ],
      now: 1_000,
    });

    assert.equal(response.plan, 'basic');
    assert.equal(response.currentItems, 2);
    assert.equal(response.maxItems, 3);
    assert.equal(response.currentReservedBytes, 90 * MIB);
    assert.equal(response.remainingItems, 1);
    assert.equal(response.canStartUpload, true);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isCurrentPublicMediaExposure,
  publicMediaDiscoveryReadRateLimitCost,
  serializePublicMediaForDiscovery,
} from './get-public-media-discovery.handler';

const NOW = 1_800_000_000_000;

function media(overrides: Record<string, unknown> = {}) {
  return {
    ownerUid: 'owner-1',
    ageEligibilityVerifiedAdult: true,
    ageEligibilityValidUntil: {
      toMillis: () => NOW + 60_000,
    },
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    publishedAt: NOW - 10_000,
    createdAt: {
      toMillis: () => NOW - 20_000,
    },
    ...overrides,
  };
}

describe('get-public-media-discovery backend-time boundary', () => {
  it('aceita somente projeção pública adulta ainda vigente', () => {
    assert.equal(isCurrentPublicMediaExposure(media(), NOW), true);

    assert.equal(
      isCurrentPublicMediaExposure(
        media({
          ageEligibilityValidUntil: { toMillis: () => NOW },
        }),
        NOW
      ),
      false
    );

    assert.equal(
      isCurrentPublicMediaExposure(
        media({
          ageEligibilityValidUntil: { toMillis: () => NOW - 1 },
        }),
        NOW
      ),
      false
    );
  });

  it('falha fechado para projeção etária ausente, não adulta ou mídia não pública', () => {
    assert.equal(
      isCurrentPublicMediaExposure(
        media({ ageEligibilityVerifiedAdult: false }),
        NOW
      ),
      false
    );
    assert.equal(
      isCurrentPublicMediaExposure(
        media({ ageEligibilityValidUntil: null }),
        NOW
      ),
      false
    );
    assert.equal(
      isCurrentPublicMediaExposure(
        media({ visibility: 'PRIVATE' }),
        NOW
      ),
      false
    );
    assert.equal(
      isCurrentPublicMediaExposure(
        media({ moderationStatus: 'QUARANTINED' }),
        NOW
      ),
      false
    );
  });

  it('serializa documento vigente e converte timestamps para epoch', () => {
    const serialized = serializePublicMediaForDiscovery(
      'media-1',
      'public_profiles/owner-1/public_photos/media-1',
      media(),
      NOW
    );

    assert.ok(serialized);
    assert.equal(serialized['id'], 'media-1');
    assert.equal(
      serialized['documentPath'],
      'public_profiles/owner-1/public_photos/media-1'
    );
    assert.equal(serialized['createdAt'], NOW - 20_000);
  });

  it('não serializa mídia cuja elegibilidade etária venceu sem nova escrita', () => {
    const serialized = serializePublicMediaForDiscovery(
      'media-expired',
      'public_profiles/owner-1/public_videos/media-expired',
      media({
        ageEligibilityValidUntil: { toMillis: () => NOW - 1 },
      }),
      NOW
    );

    assert.equal(serialized, null);
  });

  it('pondera a quota pela quantidade máxima solicitada', () => {
    assert.equal(publicMediaDiscoveryReadRateLimitCost(24), 1);
    assert.equal(publicMediaDiscoveryReadRateLimitCost(48), 2);
    assert.equal(publicMediaDiscoveryReadRateLimitCost(60), 3);
  });
});

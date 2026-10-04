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
  it('aceita projeção pública aprovada sem depender de assurance etário', () => {
    assert.equal(isCurrentPublicMediaExposure(media(), NOW), true);

    assert.equal(
      isCurrentPublicMediaExposure(
        media({
          ageEligibilityVerifiedAdult: false,
          ageEligibilityValidUntil: { toMillis: () => NOW - 1 },
        }),
        NOW
      ),
      true
    );
  });

  it('falha fechado para mídia não pública ou moderada como restrita', () => {
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
      {
        isPublished: true,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
      },
      NOW,
      { ownerAllowed: true }
    );

    assert.ok(serialized);
    assert.equal(serialized['id'], 'media-1');
    assert.equal(
      serialized['documentPath'],
      'public_profiles/owner-1/public_photos/media-1'
    );
    assert.equal(serialized['createdAt'], NOW - 20_000);
  });

  it('não deixa projeção stale conceder distribuição sem publicação autoritativa', () => {
    for (const publication of [
      null,
      {
        isPublished: false,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
      },
      {
        isPublished: true,
        visibility: 'FRIENDS',
        moderationStatus: 'APPROVED',
      },
      {
        isPublished: true,
        visibility: 'PUBLIC',
        moderationStatus: 'PENDING_REVIEW',
      },
    ]) {
      assert.equal(
        serializePublicMediaForDiscovery(
          'media-stale',
          'public_profiles/owner-1/public_photos/media-stale',
          media(),
          publication,
          NOW,
          { ownerAllowed: true }
        ),
        null
      );
    }
  });

  it('não usa campos etários legados como autoridade de distribuição', () => {
    const serialized = serializePublicMediaForDiscovery(
      'media-age-legacy',
      'public_profiles/owner-1/public_videos/media-age-legacy',
      media({
        ageEligibilityVerifiedAdult: false,
        ageEligibilityAssurance: 'SELF_DECLARED',
        ageEligibilityValidUntil: { toMillis: () => NOW - 1 },
      }),
      {
        isPublished: true,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
      },
      NOW,
      { ownerAllowed: true }
    );

    assert.equal(serialized?.['id'], 'media-age-legacy');
  });

  it('não serializa candidato quando o lifecycle do proprietário bloqueia exposição', () => {
    assert.equal(
      serializePublicMediaForDiscovery(
        'media-blocked',
        'public_profiles/owner-1/public_photos/media-blocked',
        media(),
        {
          isPublished: true,
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
        },
        NOW,
        { ownerAllowed: false }
      ),
      null
    );
  });

  it('ignora qualquer campo comercial residual na projeção orgânica', () => {
    const serialized = serializePublicMediaForDiscovery(
      'media-organic',
      'public_profiles/owner-1/public_photos/media-organic',
      media({
        legacyPromotionFlag: true,
        legacyPromotionUntil: NOW + 60_000,
      }),
      {
        isPublished: true,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
      },
      NOW,
      { ownerAllowed: true }
    );

    assert.equal(serialized?.['id'], 'media-organic');
  });

  it('pondera a quota pela quantidade máxima solicitada', () => {
    assert.equal(publicMediaDiscoveryReadRateLimitCost(24), 1);
    assert.equal(publicMediaDiscoveryReadRateLimitCost(48), 2);
    assert.equal(publicMediaDiscoveryReadRateLimitCost(60), 3);
  });
});

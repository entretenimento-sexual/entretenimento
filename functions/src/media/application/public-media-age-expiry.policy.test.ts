import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  publicAgeProjectionValidUntilMs,
  resolvePublicMediaSignedUrlExpiresAt,
} from './public-media-age-expiry.policy';

const NOW = 1_800_000_000_000;

describe('public media age expiry policy', () => {
  it('lê somente projeção adulta com validUntil timestamp íntegro', () => {
    assert.equal(
      publicAgeProjectionValidUntilMs({
        ageEligibilityVerifiedAdult: true,
        ageEligibilityValidUntil: {
          toMillis: () => NOW + 60_000,
        },
      }),
      NOW + 60_000
    );

    assert.equal(
      publicAgeProjectionValidUntilMs({
        ageEligibilityVerifiedAdult: false,
        ageEligibilityValidUntil: {
          toMillis: () => NOW + 60_000,
        },
      }),
      null
    );

    assert.equal(
      publicAgeProjectionValidUntilMs({
        ageEligibilityVerifiedAdult: true,
        ageEligibilityValidUntil: null,
      }),
      null
    );
  });

  it('limita URL pelo primeiro vencimento etário aplicável', () => {
    assert.equal(
      resolvePublicMediaSignedUrlExpiresAt({
        nowMs: NOW,
        technicalExpiresAtMs: NOW + 300_000,
        viewerExpiresAtMs: NOW + 240_000,
        ownerExpiresAtMs: NOW + 120_000,
        mediaExpiresAtMs: NOW + 180_000,
      }),
      NOW + 120_000
    );
  });

  it('aceita autoridade canônica sem expiração sem remover o teto técnico', () => {
    assert.equal(
      resolvePublicMediaSignedUrlExpiresAt({
        nowMs: NOW,
        technicalExpiresAtMs: NOW + 300_000,
        viewerExpiresAtMs: Number.POSITIVE_INFINITY,
        ownerExpiresAtMs: Number.POSITIVE_INFINITY,
        mediaExpiresAtMs: NOW + 600_000,
      }),
      NOW + 300_000
    );
  });

  it('falha fechado quando qualquer limite efetivo já venceu ou é inválido', () => {
    assert.equal(
      resolvePublicMediaSignedUrlExpiresAt({
        nowMs: NOW,
        technicalExpiresAtMs: NOW + 300_000,
        viewerExpiresAtMs: NOW - 1,
        ownerExpiresAtMs: NOW + 300_000,
        mediaExpiresAtMs: NOW + 300_000,
      }),
      null
    );

    assert.equal(
      resolvePublicMediaSignedUrlExpiresAt({
        nowMs: NOW,
        technicalExpiresAtMs: Number.NaN,
        viewerExpiresAtMs: NOW + 300_000,
        ownerExpiresAtMs: NOW + 300_000,
        mediaExpiresAtMs: NOW + 300_000,
      }),
      null
    );
  });
});

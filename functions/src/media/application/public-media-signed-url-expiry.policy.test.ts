import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolvePublicMediaSignedUrlExpiresAt,
} from './public-media-signed-url-expiry.policy';

const NOW = 1_800_000_000_000;

describe('public media signed URL expiry policy', () => {
  it('usa o TTL técnico quando não há deadline de Account Access', () => {
    assert.equal(
      resolvePublicMediaSignedUrlExpiresAt({
        nowMs: NOW,
        technicalExpiresAtMs: NOW + 300_000,
      }),
      NOW + 300_000
    );
  });

  it('limita a URL ao menor deadline genérico de acesso', () => {
    assert.equal(
      resolvePublicMediaSignedUrlExpiresAt({
        nowMs: NOW,
        technicalExpiresAtMs: NOW + 300_000,
        requesterAccessExpiresAtMs: NOW + 120_000,
        ownerAccessExpiresAtMs: NOW + 180_000,
      }),
      NOW + 120_000
    );
  });

  it('falha fechado quando qualquer deadline aplicável já venceu', () => {
    assert.equal(
      resolvePublicMediaSignedUrlExpiresAt({
        nowMs: NOW,
        technicalExpiresAtMs: NOW + 300_000,
        requesterAccessExpiresAtMs: NOW,
      }),
      null
    );

    assert.equal(
      resolvePublicMediaSignedUrlExpiresAt({
        nowMs: NOW,
        technicalExpiresAtMs: Number.NaN,
      }),
      null
    );
  });
});

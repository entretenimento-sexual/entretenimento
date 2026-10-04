import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolvePublicMediaSignedUrlExpiresAt,
} from './public-media-signed-url-expiry.policy';

const NOW = 1_800_000_000_000;

describe('public media signed URL expiry policy', () => {
  it('usa somente o TTL técnico da URL temporária', () => {
    assert.equal(
      resolvePublicMediaSignedUrlExpiresAt({
        nowMs: NOW,
        technicalExpiresAtMs: NOW + 300_000,
      }),
      NOW + 300_000
    );
  });

  it('falha fechado para relógios inválidos ou vencidos', () => {
    assert.equal(
      resolvePublicMediaSignedUrlExpiresAt({
        nowMs: NOW,
        technicalExpiresAtMs: NOW,
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

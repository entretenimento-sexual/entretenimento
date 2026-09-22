import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normalizeProviderAgeAssertion,
  resolveProviderAssertionCanonicalStatus,
} from './age-verification-provider-assertion.policy';

const NOW = 1_800_000_000_000;
const HASH = 'a'.repeat(64);

describe('age-verification-provider-assertion.policy', () => {
  it('aceita somente assertion mínima e confiável', () => {
    const result = normalizeProviderAgeAssertion({
      assertionId: 'assertion-1',
      nowMs: NOW,
      raw: {
        uid: 'user-1',
        provider: 'trusted-provider',
        result: 'VERIFIED_ADULT',
        assuranceLevel: 'HIGH',
        verifiedAtMs: NOW - 1_000,
        expiresAtMs: NOW + 10_000,
        providerReferenceHash: HASH,
      },
    });

    assert.equal(result?.uid, 'user-1');
    assert.equal(result?.result, 'VERIFIED_ADULT');
  });

  it('rejeita payload sem referência pseudonimizada do provider', () => {
    const result = normalizeProviderAgeAssertion({
      assertionId: 'assertion-1',
      nowMs: NOW,
      raw: {
        uid: 'user-1',
        provider: 'trusted-provider',
        result: 'VERIFIED_ADULT',
        assuranceLevel: 'HIGH',
        verifiedAtMs: NOW - 1_000,
        expiresAtMs: null,
        providerReferenceHash: 'raw-id',
      },
    });

    assert.equal(result, null);
  });

  it('transforma decisão conflitante em revisão obrigatória', () => {
    assert.equal(
      resolveProviderAssertionCanonicalStatus({
        currentStatus: 'VERIFIED_ADULT',
        assertionResult: 'DENIED_UNDERAGE',
      }),
      'REVIEW_REQUIRED'
    );
    assert.equal(
      resolveProviderAssertionCanonicalStatus({
        currentStatus: 'DENIED_UNDERAGE',
        assertionResult: 'VERIFIED_ADULT',
      }),
      'REVIEW_REQUIRED'
    );
  });
});

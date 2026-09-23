import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normalizeAgeReviewEvidence,
} from './age-review-evidence.policy';

describe('age-review-evidence.policy', () => {
  it('gera hash estável sem devolver a referência bruta', () => {
    const result = normalizeAgeReviewEvidence({
      method: 'MANUAL_DOCUMENT_REVIEW',
      reference: 'provider-case-123456',
    });

    assert.ok(result);
    assert.equal(result.method, 'MANUAL_DOCUMENT_REVIEW');
    assert.match(result.referenceHash, /^[a-f0-9]{64}$/);
    assert.equal(
      Object.values(result).includes('provider-case-123456'),
      false
    );
  });

  it('rejeita autodeclaração como método de evidência', () => {
    const result = normalizeAgeReviewEvidence({
      method: 'SELF_DECLARATION_REVIEW',
      reference: 'declared-adult',
    });

    assert.equal(result, null);
  });

  it('rejeita referência vazia ou curta demais', () => {
    assert.equal(
      normalizeAgeReviewEvidence({
        method: 'PROFILE_KYC',
        reference: '123',
      }),
      null
    );
  });
});

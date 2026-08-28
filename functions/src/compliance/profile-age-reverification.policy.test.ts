import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAgeReverificationDueAt,
  calculateAgeBand,
  isAgeReverificationAccessRestricted,
  isProfileMinorSafetyReport,
} from './profile-age-reverification.policy';

describe('profile-age-reverification policy', () => {
  it('aceita apenas denúncia de perfil por possível menoridade', () => {
    assert.equal(isProfileMinorSafetyReport({
      targetType: 'profile',
      reason: 'minor_safety',
    }), true);
    assert.equal(isProfileMinorSafetyReport({
      targetType: 'video',
      reason: 'minor_safety',
    }), false);
    assert.equal(isProfileMinorSafetyReport({
      targetType: 'profile',
      reason: 'fake_profile',
    }), false);
  });

  it('calcula a faixa etária sem persistir a data de nascimento', () => {
    const now = Date.UTC(2026, 6, 16);

    assert.equal(calculateAgeBand('2008-07-16', now), '18_PLUS');
    assert.equal(calculateAgeBand('2008-07-17', now), 'UNDER_18');
    assert.equal(calculateAgeBand('2026-02-30', now), null);
    assert.equal(calculateAgeBand('1890-01-01', now), null);
  });

  it('restringe somente estados pendentes de revalidação', () => {
    assert.equal(isAgeReverificationAccessRestricted('REQUIRED'), true);
    assert.equal(isAgeReverificationAccessRestricted('SUBMITTED'), true);
    assert.equal(isAgeReverificationAccessRestricted('UNDER_REVIEW'), true);
    assert.equal(isAgeReverificationAccessRestricted('EXPIRED'), true);
    assert.equal(isAgeReverificationAccessRestricted('VERIFIED'), false);
    assert.equal(isAgeReverificationAccessRestricted('REJECTED'), false);
  });

  it('define prazo padrão de sete dias', () => {
    const requestedAt = Date.UTC(2026, 6, 16);

    assert.equal(
      buildAgeReverificationDueAt(requestedAt),
      requestedAt + 7 * 24 * 60 * 60 * 1000
    );
  });
});

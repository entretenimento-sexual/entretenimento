import { describe, expect, it } from 'vitest';

import {
  buildAgeReverificationDueAt,
  calculateAgeBand,
  isAgeReverificationAccessRestricted,
  isProfileMinorSafetyReport,
} from './profile-age-reverification.policy';

describe('profile age reverification policy', () => {
  it('aceita apenas denúncia de perfil por possível menoridade', () => {
    expect(isProfileMinorSafetyReport({
      targetType: 'profile',
      reason: 'minor_safety',
    })).toBe(true);
    expect(isProfileMinorSafetyReport({
      targetType: 'video',
      reason: 'minor_safety',
    })).toBe(false);
    expect(isProfileMinorSafetyReport({
      targetType: 'profile',
      reason: 'fake_profile',
    })).toBe(false);
  });

  it('calcula a faixa etária sem persistir a data de nascimento', () => {
    const now = Date.UTC(2026, 6, 16);

    expect(calculateAgeBand('2008-07-16', now)).toBe('18_PLUS');
    expect(calculateAgeBand('2008-07-17', now)).toBe('UNDER_18');
    expect(calculateAgeBand('2026-02-30', now)).toBeNull();
    expect(calculateAgeBand('1890-01-01', now)).toBeNull();
  });

  it('restringe somente estados pendentes de revalidação', () => {
    expect(isAgeReverificationAccessRestricted('REQUIRED')).toBe(true);
    expect(isAgeReverificationAccessRestricted('SUBMITTED')).toBe(true);
    expect(isAgeReverificationAccessRestricted('UNDER_REVIEW')).toBe(true);
    expect(isAgeReverificationAccessRestricted('EXPIRED')).toBe(true);
    expect(isAgeReverificationAccessRestricted('VERIFIED')).toBe(false);
    expect(isAgeReverificationAccessRestricted('REJECTED')).toBe(false);
  });

  it('define prazo padrão de sete dias', () => {
    const requestedAt = Date.UTC(2026, 6, 16);
    expect(buildAgeReverificationDueAt(requestedAt)).toBe(
      requestedAt + 7 * 24 * 60 * 60 * 1000
    );
  });
});

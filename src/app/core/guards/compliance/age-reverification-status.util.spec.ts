import { describe, expect, it } from 'vitest';

import {
  isAgeReverificationAccessRestricted,
  normalizeAgeReverificationStatus,
} from './age-reverification-status.util';

describe('age reverification status', () => {
  it('normaliza estados desconhecidos para NONE', () => {
    expect(normalizeAgeReverificationStatus('required')).toBe('REQUIRED');
    expect(normalizeAgeReverificationStatus('invalid')).toBe('NONE');
  });

  it('restringe apenas casos pendentes', () => {
    expect(isAgeReverificationAccessRestricted({ status: 'REQUIRED' })).toBe(true);
    expect(isAgeReverificationAccessRestricted({ status: 'SUBMITTED' })).toBe(true);
    expect(isAgeReverificationAccessRestricted({ status: 'UNDER_REVIEW' })).toBe(true);
    expect(isAgeReverificationAccessRestricted({ status: 'EXPIRED' })).toBe(true);
    expect(isAgeReverificationAccessRestricted({ status: 'VERIFIED' })).toBe(false);
    expect(isAgeReverificationAccessRestricted({ status: 'REJECTED' })).toBe(false);
    expect(isAgeReverificationAccessRestricted(null)).toBe(false);
  });
});

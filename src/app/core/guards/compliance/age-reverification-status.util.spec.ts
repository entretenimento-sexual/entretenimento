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
});

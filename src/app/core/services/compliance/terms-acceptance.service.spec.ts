import { describe, expect, it } from 'vitest';

import {
  TERMS_ACCEPTANCE_VERSION,
  hasAcceptedCurrentTerms,
} from './terms-acceptance.service';

describe('hasAcceptedCurrentTerms', () => {
  it('nega ausência de evidência', () => {
    expect(hasAcceptedCurrentTerms(undefined)).toBe(false);
    expect(hasAcceptedCurrentTerms(null)).toBe(false);
  });

  it('nega aceite explicitamente falso', () => {
    expect(
      hasAcceptedCurrentTerms({ accepted: false, date: Date.now() })
    ).toBe(false);
  });

  it('aceita a versão atual registrada', () => {
    expect(
      hasAcceptedCurrentTerms({
        accepted: true,
        date: Date.now(),
        version: TERMS_ACCEPTANCE_VERSION,
      })
    ).toBe(true);
  });

  it('nega versão diferente da atual', () => {
    expect(
      hasAcceptedCurrentTerms({
        accepted: true,
        date: Date.now(),
        version: 'versao-antiga',
      })
    ).toBe(false);
  });
});

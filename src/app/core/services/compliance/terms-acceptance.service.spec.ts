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

  it('aceita somente a versão atual registrada', () => {
    expect(TERMS_ACCEPTANCE_VERSION).toBe('v2');
    expect(
      hasAcceptedCurrentTerms({
        accepted: true,
        date: Date.now(),
        version: TERMS_ACCEPTANCE_VERSION,
      })
    ).toBe(true);
  });

  it('exige novo aceite de registros v1 e legados sem versão', () => {
    expect(
      hasAcceptedCurrentTerms({
        accepted: true,
        date: Date.now(),
        version: 'v1',
      })
    ).toBe(false);

    expect(
      hasAcceptedCurrentTerms({
        accepted: true,
        date: Date.now(),
      })
    ).toBe(false);
  });

  it('nega qualquer outra versão diferente da atual', () => {
    expect(
      hasAcceptedCurrentTerms({
        accepted: true,
        date: Date.now(),
        version: 'versao-desconhecida',
      })
    ).toBe(false);
  });
});

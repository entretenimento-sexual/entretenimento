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

  it('aceita somente a versão atual com ciência de privacidade registrada', () => {
    expect(TERMS_ACCEPTANCE_VERSION).toBe('v3');
    expect(
      hasAcceptedCurrentTerms({
        accepted: true,
        date: Date.now(),
        version: TERMS_ACCEPTANCE_VERSION,
        acknowledgedPrivacyNotice: true,
      })
    ).toBe(true);
  });

  it('exige ciência explícita da Política de Privacidade', () => {
    expect(
      hasAcceptedCurrentTerms({
        accepted: true,
        date: Date.now(),
        version: TERMS_ACCEPTANCE_VERSION,
      })
    ).toBe(false);
  });

  it('exige novo aceite de registros v1, v2 e legados sem versão', () => {
    for (const version of ['v1', 'v2']) {
      expect(
        hasAcceptedCurrentTerms({
          accepted: true,
          date: Date.now(),
          version,
          acknowledgedPrivacyNotice: true,
        })
      ).toBe(false);
    }

    expect(
      hasAcceptedCurrentTerms({
        accepted: true,
        date: Date.now(),
        acknowledgedPrivacyNotice: true,
      })
    ).toBe(false);
  });

  it('nega qualquer outra versão diferente da atual', () => {
    expect(
      hasAcceptedCurrentTerms({
        accepted: true,
        date: Date.now(),
        version: 'versao-desconhecida',
        acknowledgedPrivacyNotice: true,
      })
    ).toBe(false);
  });
});

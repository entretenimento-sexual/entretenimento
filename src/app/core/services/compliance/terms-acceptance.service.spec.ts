import { describe, expect, it } from 'vitest';

import {
  CURRENT_LEGAL_ACCEPTANCE_ENFORCED,
  TERMS_ACCEPTANCE_VERSION,
  hasAcceptedCurrentTerms,
  isCurrentTermsRecordAccepted,
} from './terms-acceptance.service';

describe('política de aceite jurídico', () => {
  it('mantém o dev-real explicitamente fora da barreira jurídica remota', () => {
    expect(CURRENT_LEGAL_ACCEPTANCE_ENFORCED).toBe(false);
    expect(hasAcceptedCurrentTerms(undefined)).toBe(true);
    expect(hasAcceptedCurrentTerms(null)).toBe(true);
  });

  it('mantém a validação persistida fail-closed sem evidência', () => {
    expect(isCurrentTermsRecordAccepted(undefined)).toBe(false);
    expect(isCurrentTermsRecordAccepted(null)).toBe(false);
    expect(
      isCurrentTermsRecordAccepted({ accepted: false, date: Date.now() })
    ).toBe(false);
  });

  it('aceita estritamente a versão vigente com ciência de privacidade', () => {
    expect(TERMS_ACCEPTANCE_VERSION).toBe('v3');
    expect(
      isCurrentTermsRecordAccepted({
        accepted: true,
        date: Date.now(),
        version: TERMS_ACCEPTANCE_VERSION,
        acknowledgedPrivacyNotice: true,
      })
    ).toBe(true);
  });

  it('recusa v3 sem ciência explícita da Política de Privacidade', () => {
    expect(
      isCurrentTermsRecordAccepted({
        accepted: true,
        date: Date.now(),
        version: TERMS_ACCEPTANCE_VERSION,
      })
    ).toBe(false);
  });

  it('recusa v2, v1, versões desconhecidas e registros sem versão na regra persistida', () => {
    for (const version of ['v2', 'v1', 'versao-desconhecida']) {
      expect(
        isCurrentTermsRecordAccepted({
          accepted: true,
          date: Date.now(),
          version,
          acknowledgedPrivacyNotice: true,
        })
      ).toBe(false);
    }

    expect(
      isCurrentTermsRecordAccepted({
        accepted: true,
        date: Date.now(),
        acknowledgedPrivacyNotice: true,
      })
    ).toBe(false);
  });
});

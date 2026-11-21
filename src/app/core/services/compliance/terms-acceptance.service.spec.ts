import { describe, expect, it } from 'vitest';

import {
  TERMS_ACCEPTANCE_VERSION,
  hasAcceptedCurrentTerms,
  isCurrentTermsRecordAccepted,
} from './terms-acceptance.service';

describe('política de aceite jurídico', () => {
  it('usa evidência persistida para a política de acesso', () => {
    expect(hasAcceptedCurrentTerms(undefined)).toBe(false);
    expect(hasAcceptedCurrentTerms(null)).toBe(false);
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
        termsDocumentVersion: '2026-09-29.1',
        privacyNoticeVersion: '2026-09-29.1',
        acknowledgedPrivacyNotice: true,
      })
    ).toBe(true);
  });

  it('exige as versões dos dois documentos além da versão do aceite', () => {
    const acceptance = {
      accepted: true, date: Date.now(), acknowledgedPrivacyNotice: true,
      version: TERMS_ACCEPTANCE_VERSION,
      termsDocumentVersion: '2026-09-29.1',
      privacyNoticeVersion: '2026-09-29.1',
    };
    for (const change of [
      { termsDocumentVersion: null },
      { termsDocumentVersion: 'anterior' },
      { privacyNoticeVersion: null },
      { privacyNoticeVersion: 'anterior' },
    ]) {
      expect(isCurrentTermsRecordAccepted({ ...acceptance, ...change })).toBe(false);
    }
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

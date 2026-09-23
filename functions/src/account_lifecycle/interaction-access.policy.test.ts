import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertInteractionAccessData } from './interaction-access.policy';

const validUser = {
  accountStatus: 'active',
  suspended: false,
  interactionBlocked: false,
  acceptedTerms: {
    accepted: true,
    version: 'v3',
    acknowledgedPrivacyNotice: true,
  },
  adultConsent: {
    accepted: true,
    version: 'v1',
  },
  ageReverification: { status: 'VERIFIED' },
};

const validAge = {
  uid: 'user-1',
  status: 'VERIFIED_ADULT',
  policyVersion: 1,
  source: 'AGE_REVERIFICATION',
  method: 'MANUAL_REVIEW',
  caseId: 'case-1',
  verifiedAtMs: Date.now() - 1_000,
  expiresAtMs: null,
};

describe('interaction access policy', () => {
  it('permite conta ativa com fronteiras adultas satisfeitas', () => {
    assert.doesNotThrow(() => assertInteractionAccessData(
      validUser,
      validAge,
      'user-1'
    ));
  });

  it('permite interação com autodeclaração adulta backend no modo atual', () => {
    assert.doesNotThrow(() => assertInteractionAccessData(
      validUser,
      {
        uid: 'user-1',
        status: 'DECLARED_ADULT',
        policyVersion: 1,
        source: 'SELF_ATTESTATION',
        method: 'SELF_ATTESTATION',
        assuranceLevel: 'SELF_ATTESTED',
        caseId: null,
        verifiedAtMs: null,
        decidedAtMs: Date.now() - 1_000,
        expiresAtMs: null,
      },
      'user-1'
    ));
  });

  it('bloqueia conta com interactionBlocked', () => {
    assert.throws(() => assertInteractionAccessData(
      {
        ...validUser,
        interactionBlocked: true,
      },
      validAge,
      'user-1'
    ));
  });

  it('bloqueia estados pendentes de revalidação', () => {
    for (const status of [
      'REQUIRED',
      'SUBMITTED',
      'UNDER_REVIEW',
      'EXPIRED',
    ]) {
      assert.throws(() => assertInteractionAccessData(
        {
          ...validUser,
          ageReverification: { status },
        },
        validAge,
        'user-1'
      ));
    }
  });

  it('bloqueia conta suspensa ou fora do estado ativo', () => {
    assert.throws(() => assertInteractionAccessData(
      {
        ...validUser,
        accountStatus: 'moderation_suspended',
        suspended: true,
        interactionBlocked: true,
      },
      validAge,
      'user-1'
    ));
  });

  it('bloqueia interação sem prova etária canônica', () => {
    assert.throws(() => assertInteractionAccessData(
      validUser,
      null,
      'user-1'
    ));
  });

  it('bloqueia interação sem termos atuais', () => {
    assert.throws(() => assertInteractionAccessData(
      {
        ...validUser,
        acceptedTerms: {
          accepted: false,
          version: 'v3',
          acknowledgedPrivacyNotice: true,
        },
      },
      validAge,
      'user-1'
    ));
  });

  it('bloqueia interação sem consentimento adulto vigente', () => {
    assert.throws(() => assertInteractionAccessData(
      {
        ...validUser,
        adultConsent: {
          accepted: false,
          version: 'v1',
        },
      },
      validAge,
      'user-1'
    ));
  });
});

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
};

describe('interaction access policy', () => {
  it('permite conta ativa com termos e consentimento vigentes', () => {
    assert.doesNotThrow(() => assertInteractionAccessData(
      validUser,
      null,
      'user-1'
    ));
  });

  it('não usa assurance ou reverificação etária como segundo gate', () => {
    for (const ageRecord of [
      null,
      { status: 'SELF_DECLARED_ADULT' },
      { status: 'VERIFIED_ADULT' },
      { status: 'EXPIRED' },
    ]) {
      assert.doesNotThrow(() => assertInteractionAccessData(
        validUser,
        ageRecord,
        'user-1'
      ));
    }
  });

  it('bloqueia conta com interactionBlocked', () => {
    assert.throws(() => assertInteractionAccessData(
      {
        ...validUser,
        interactionBlocked: true,
      },
      null,
      'user-1'
    ));
  });

  it('bloqueia conta suspensa ou fora do estado ativo', () => {
    assert.throws(() => assertInteractionAccessData(
      {
        ...validUser,
        accountStatus: 'moderation_suspended',
        suspended: true,
        interactionBlocked: true,
      },
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
      null,
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
      null,
      'user-1'
    ));
  });
});

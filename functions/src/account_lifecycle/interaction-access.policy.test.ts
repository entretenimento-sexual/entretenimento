import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertPlatformAccountAccessData } from './interaction-access.policy';

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
  it('permite lifecycle/legal válido', () => {
    assert.doesNotThrow(() => assertPlatformAccountAccessData(validUser));
  });

  it('não reinterpreta assurance etário dentro do gate de produto', () => {
    assert.doesNotThrow(() => assertPlatformAccountAccessData(validUser));
  });

  it('falha fechado quando accountStatus não está active', () => {
    const { accountStatus: _accountStatus, ...withoutStatus } = validUser;
    assert.throws(() => assertPlatformAccountAccessData(withoutStatus));
  });

  it('bloqueia conta com interactionBlocked', () => {
    assert.throws(() =>
      assertPlatformAccountAccessData({
        ...validUser,
        interactionBlocked: true,
      })
    );
  });

  it('bloqueia conta suspensa ou fora do estado ativo', () => {
    assert.throws(() =>
      assertPlatformAccountAccessData({
        ...validUser,
        accountStatus: 'moderation_suspended',
        suspended: true,
        interactionBlocked: true,
      })
    );
  });

  it('bloqueia interação sem termos atuais', () => {
    assert.throws(() =>
      assertPlatformAccountAccessData({
        ...validUser,
        acceptedTerms: {
          accepted: false,
          version: 'v3',
          acknowledgedPrivacyNotice: true,
        },
      })
    );
  });

  it('bloqueia interação sem consentimento adulto vigente', () => {
    assert.throws(() =>
      assertPlatformAccountAccessData({
        ...validUser,
        adultConsent: {
          accepted: false,
          version: 'v1',
        },
      })
    );
  });
});

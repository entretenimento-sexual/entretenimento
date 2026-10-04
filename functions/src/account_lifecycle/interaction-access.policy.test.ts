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
  it('permite conta ativa com termos e consentimento vigentes', () => {
    assert.doesNotThrow(() => assertPlatformAccountAccessData(validUser));
  });

  it('não recebe assurance etário como parâmetro de autorização', () => {
    assert.doesNotThrow(() => assertPlatformAccountAccessData(validUser));
  });

  it('bloqueia conta com interactionBlocked', () => {
    assert.throws(() => assertPlatformAccountAccessData({ ...validUser, interactionBlocked: true }));
  });

  it('bloqueia conta suspensa ou fora do estado ativo', () => {
    assert.throws(() => assertPlatformAccountAccessData({ ...validUser, accountStatus: 'moderation_suspended', suspended: true, interactionBlocked: true }));
  });

  it('bloqueia interação sem termos atuais', () => {
    assert.throws(() => assertPlatformAccountAccessData({ ...validUser, acceptedTerms: { accepted: false, version: 'v3', acknowledgedPrivacyNotice: true } }));
  });

  it('bloqueia interação sem consentimento adulto vigente', () => {
    assert.throws(() => assertPlatformAccountAccessData({ ...validUser, adultConsent: { accepted: false, version: 'v1' } }));
  });
});

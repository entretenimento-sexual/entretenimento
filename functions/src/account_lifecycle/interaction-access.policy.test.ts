import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertPlatformAccountAccessData,
  assertTrustedAdultAccountAccessData,
} from './interaction-access.policy';

const NOW = 1_800_000_000_000;

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

const verifiedAge = {
  uid: 'user-1',
  status: 'VERIFIED_ADULT',
  policyVersion: 1,
  source: 'INITIAL_VERIFICATION',
  method: 'EXTERNAL_PROVIDER',
  verifiedAtMs: NOW - 1_000,
  expiresAtMs: NOW + 60_000,
};

describe('interaction access policy', () => {
  it('permite lifecycle/legal válido', () => {
    assert.doesNotThrow(() => assertPlatformAccountAccessData(validUser));
  });

  it('libera Account Access somente com assurance confiável vigente', () => {
    assert.deepEqual(
      assertTrustedAdultAccountAccessData('user-1', verifiedAge, NOW),
      { accessExpiresAtMs: NOW + 60_000 }
    );
  });

  it('nega autodeclaração como autorização de Account Access', () => {
    assert.throws(() =>
      assertTrustedAdultAccountAccessData(
        'user-1',
        {
          uid: 'user-1',
          status: 'SELF_DECLARED_ADULT',
          policyVersion: 1,
          source: 'SELF_DECLARATION',
          method: 'SELF_DECLARATION',
          decidedAtMs: NOW - 1_000,
          expiresAtMs: null,
        },
        NOW
      )
    );
  });

  it('nega assurance confiável vencida', () => {
    assert.throws(() =>
      assertTrustedAdultAccountAccessData(
        'user-1',
        { ...verifiedAge, expiresAtMs: NOW - 1 },
        NOW
      )
    );
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

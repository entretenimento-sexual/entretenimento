import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateAccountOperationalAccess,
} from '../../account_lifecycle/account-operational-access.policy';
import {
  evaluateVideoAccountAccess,
} from './video-audience-access.policy';

function account(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-uid',
    accountStatus: 'active',
    suspended: false,
    interactionBlocked: false,
    accountLocked: false,
    loginAllowed: true,
    emailVerified: true,
    profileCompleted: true,
    initialAdultConsentRequired: true,
    adultConsent: { accepted: true },
    acceptedTerms: {
      accepted: true,
      adultAccessAcknowledgement: true,
    },
    ageReverification: { status: 'VERIFIED', result: 'ADULT' },
    ...overrides,
  };
}

function canonicalAllowed(
  user: Record<string, unknown>,
  authDisabled = false
): boolean {
  return evaluateAccountOperationalAccess(
    user,
    'user-uid',
    { disabled: authDisabled, emailVerified: true }
  ).allowed;
}

function videoAllowed(
  user: Record<string, unknown>,
  authDisabled = false
): boolean {
  return evaluateVideoAccountAccess(
    user,
    'user-uid',
    {
      authDisabled,
      authenticatedEmailVerified: true,
    }
  ).allowed;
}

describe('media account policy contract', () => {
  it('mantém a conta operacional equivalente na policy canônica e na audiência de vídeo', () => {
    assert.equal(canonicalAllowed(account()), true);
    assert.equal(videoAllowed(account()), true);
  });

  it('mantém equivalência em todos os estados restritos de lifecycle', () => {
    const cases: Record<string, unknown>[] = [
      { accountStatus: 'self_suspended' },
      { accountStatus: 'moderation_suspended' },
      { accountStatus: 'pending_deletion' },
      { accountStatus: 'deleted' },
      { suspended: true },
      { interactionBlocked: true },
      { accountLocked: true },
      { loginAllowed: false },
    ];

    for (const overrides of cases) {
      const user = account(overrides);
      assert.equal(canonicalAllowed(user), false, JSON.stringify(overrides));
      assert.equal(videoAllowed(user), false, JSON.stringify(overrides));
    }
  });

  it('mantém equivalência para Auth desabilitado e acesso adulto', () => {
    assert.equal(canonicalAllowed(account(), true), false);
    assert.equal(videoAllowed(account(), true), false);

    for (const status of [
      'REQUIRED',
      'SUBMITTED',
      'UNDER_REVIEW',
      'REJECTED',
      'EXPIRED',
    ]) {
      const user = account({ ageReverification: { status } });
      assert.equal(canonicalAllowed(user), false, status);
      assert.equal(videoAllowed(user), false, status);
    }

    const underage = account({
      ageReverification: { status: 'VERIFIED', result: 'UNDERAGE' },
    });
    assert.equal(canonicalAllowed(underage), false);
    assert.equal(videoAllowed(underage), false);
  });

  it('mantém equivalência para e-mail, consentimento, termos e perfil', () => {
    const cases: Record<string, unknown>[] = [
      { emailVerified: false },
      { adultConsent: { accepted: false } },
      { acceptedTerms: { accepted: false } },
      { profileCompleted: false },
    ];

    for (const overrides of cases) {
      const user = account(overrides);
      const canonical = evaluateAccountOperationalAccess(
        user,
        'user-uid',
        { disabled: false, emailVerified: false }
      ).allowed;
      const video = evaluateVideoAccountAccess(
        user,
        'user-uid',
        {
          authDisabled: false,
          authenticatedEmailVerified: false,
        }
      ).allowed;

      assert.equal(canonical, false, JSON.stringify(overrides));
      assert.equal(video, false, JSON.stringify(overrides));
    }
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateAccountOperationalAccess,
} from './account-operational-access.policy';

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

describe('account operational access policy', () => {
  it('permite uma conta integralmente operacional', () => {
    assert.deepEqual(
      evaluateAccountOperationalAccess(
        account(),
        'user-uid',
        { disabled: false, emailVerified: true }
      ),
      { allowed: true, reason: null }
    );
  });

  it('nega UID divergente, Auth desabilitado e estados de lifecycle', () => {
    assert.equal(
      evaluateAccountOperationalAccess(account(), 'other-uid').reason,
      'PROFILE_MISSING'
    );
    assert.equal(
      evaluateAccountOperationalAccess(
        account(),
        'user-uid',
        { disabled: true, emailVerified: true }
      ).reason,
      'AUTH_DISABLED'
    );

    for (const accountStatus of [
      'self_suspended',
      'moderation_suspended',
      'pending_deletion',
      'deleted',
    ]) {
      assert.equal(
        evaluateAccountOperationalAccess(
          account({ accountStatus }),
          'user-uid'
        ).reason,
        'ACCOUNT_RESTRICTED'
      );
    }
  });

  it('nega campos derivados restritivos mesmo com accountStatus ativo', () => {
    for (const overrides of [
      { suspended: true },
      { interactionBlocked: true },
      { accountLocked: true },
      { loginAllowed: false },
    ]) {
      assert.equal(
        evaluateAccountOperationalAccess(
          account(overrides),
          'user-uid'
        ).reason,
        'ACCOUNT_RESTRICTED'
      );
    }
  });

  it('nega todos os estados restritos de revalidação e menoridade', () => {
    for (const status of [
      'REQUIRED',
      'SUBMITTED',
      'UNDER_REVIEW',
      'REJECTED',
      'EXPIRED',
    ]) {
      assert.equal(
        evaluateAccountOperationalAccess(
          account({ ageReverification: { status } }),
          'user-uid'
        ).reason,
        'ADULT_ACCESS_REQUIRED'
      );
    }

    assert.equal(
      evaluateAccountOperationalAccess(
        account({ ageReverification: { result: 'UNDERAGE' } }),
        'user-uid'
      ).reason,
      'ADULT_ACCESS_REQUIRED'
    );
  });

  it('nega e-mail, consentimento, termos e perfil incompleto', () => {
    assert.equal(
      evaluateAccountOperationalAccess(
        account({ emailVerified: false }),
        'user-uid',
        { disabled: false, emailVerified: false }
      ).reason,
      'EMAIL_UNVERIFIED'
    );
    assert.equal(
      evaluateAccountOperationalAccess(
        account({ adultConsent: { accepted: false } }),
        'user-uid'
      ).reason,
      'ADULT_ACCESS_REQUIRED'
    );
    assert.equal(
      evaluateAccountOperationalAccess(
        account({ acceptedTerms: { accepted: false } }),
        'user-uid'
      ).reason,
      'TERMS_REQUIRED'
    );
    assert.equal(
      evaluateAccountOperationalAccess(
        account({ profileCompleted: false }),
        'user-uid'
      ).reason,
      'PROFILE_INCOMPLETE'
    );
  });
});

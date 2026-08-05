import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertInteractionAccessData } from './interaction-access.policy';

function operationalAccount(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-uid',
    accountStatus: 'active',
    suspended: false,
    interactionBlocked: false,
    accountLocked: false,
    loginAllowed: true,
    initialAdultConsentRequired: true,
    adultConsent: { accepted: true },
    ageReverification: { status: 'VERIFIED', result: 'ADULT' },
    ...overrides,
  };
}

describe('interaction access policy', () => {
  it('permite conta ativa sem bloqueios', () => {
    assert.doesNotThrow(() => assertInteractionAccessData(
      operationalAccount()
    ));
  });

  it('bloqueia conta com interactionBlocked', () => {
    assert.throws(() => assertInteractionAccessData(
      operationalAccount({ interactionBlocked: true })
    ));
  });

  it('bloqueia todos os estados restritos de revalidação', () => {
    for (const status of [
      'REQUIRED',
      'SUBMITTED',
      'UNDER_REVIEW',
      'REJECTED',
      'EXPIRED',
    ]) {
      assert.throws(() => assertInteractionAccessData(
        operationalAccount({ ageReverification: { status } })
      ));
    }
  });

  it('bloqueia suspensão, lock administrativo e login desabilitado', () => {
    assert.throws(() => assertInteractionAccessData(
      operationalAccount({
        accountStatus: 'moderation_suspended',
        suspended: true,
        interactionBlocked: true,
      })
    ));
    assert.throws(() => assertInteractionAccessData(
      operationalAccount({ accountLocked: true })
    ));
    assert.throws(() => assertInteractionAccessData(
      operationalAccount({ loginAllowed: false })
    ));
  });
});

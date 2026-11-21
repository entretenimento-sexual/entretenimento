import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertPlatformAccountAccessData } from './interaction-access.policy';

const validUser = {
  accountStatus: 'active',
  profileCompleted: true,
  suspended: false,
  interactionBlocked: false,
  acceptedTerms: {
    accepted: true,
    version: 'v3',
    termsDocumentVersion: '2026-09-29.1',
    privacyNoticeVersion: '2026-09-29.1',
    acknowledgedPrivacyNotice: true,
  },
};

describe('interaction access policy', () => {
  it('permite lifecycle/legal válido', () => {
    assert.doesNotThrow(() => assertPlatformAccountAccessData(validUser));
  });

  it('não reinterpreta assurance etário dentro do gate de produto', () => {
    for (const ageEligibility of [
      { status: 'SELF_DECLARED_ADULT', policyVersion: 1 },
      { status: 'VERIFIED_ADULT', policyVersion: 1 },
      { status: 'EXPIRED', policyVersion: 1 },
      null,
    ]) {
      assert.doesNotThrow(() =>
        assertPlatformAccountAccessData({
          ...validUser, ...{ ageEligibility },
        } as typeof validUser)
      );
    }
  });

  it('falha fechado quando accountStatus não está active', () => {
    const { accountStatus: _accountStatus, ...withoutStatus } = validUser;
    assert.throws(() => assertPlatformAccountAccessData(withoutStatus));
  });

  it('nega uso da plataforma para accountLocked ou loginAllowed false', () => {
    for (const blocked of [
      { accountLocked: true },
      { loginAllowed: false },
      { accountLocked: true, loginAllowed: false },
    ]) {
      assert.throws(() => assertPlatformAccountAccessData({
        ...validUser, ...blocked,
      }));
    }
  });

  it('distingue cadastro pendente de bloqueio em conta incompleta', () => {
    const pending = { ...validUser, profileCompleted: false };
    assert.throws(() => assertPlatformAccountAccessData(pending), { details: {
      reason: 'registration_pending',
    } });
    assert.throws(() => assertPlatformAccountAccessData({ ...pending, accountLocked: true }), { details: {
      reason: 'account_interaction_blocked',
    } });
    const { profileCompleted: _profileCompleted, ...missingCompletion } = validUser;
    assert.throws(() => assertPlatformAccountAccessData(missingCompletion), { details: {
      reason: 'registration_pending',
    } });
    assert.throws(() => assertPlatformAccountAccessData({ ...pending, deletionRequestedAt: 1 }), { details: {
      reason: 'account_interaction_blocked',
    } });
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
    for (const overrides of [
      { accepted: false },
      { version: 'anterior' },
      { termsDocumentVersion: 'anterior' },
      { privacyNoticeVersion: 'anterior' },
      { acknowledgedPrivacyNotice: false },
    ]) {
      assert.throws(() => assertPlatformAccountAccessData({
        ...validUser,
        acceptedTerms: { ...validUser.acceptedTerms, ...overrides },
      }), {
        code: 'failed-precondition',
        details: { reason: 'terms_required', recommendedAction: 'accept_terms' },
      });
    }
  });

  it('não usa marcador histórico como gate de produto', () => {
    for (const adultConsent of [
      undefined,
      null,
      { accepted: false, version: 'v1' },
      { accepted: true, version: 'v1' },
    ]) {
      const historicalAccount = {
        ...validUser,
        initialAdultConsentRequired: true,
        adultConsent,
      };
      assert.doesNotThrow(() => assertPlatformAccountAccessData(historicalAccount));
    }
  });

  it('continua negando hold materializado de moderação', () => {
    assert.throws(() => assertPlatformAccountAccessData({
      ...validUser,
      moderationAutomationHold: { active: true, expiresAtMs: Date.now() + 60_000 },
    }));
  });

  it('permite conta já admitida sem consentimento adulto legado', () => {
    assert.doesNotThrow(() => assertPlatformAccountAccessData(validUser));

    const legacyRefusedUser = {
      ...validUser,
      adultConsent: { accepted: false, version: 'v1' },
    };
    assert.doesNotThrow(() => assertPlatformAccountAccessData(legacyRefusedUser));
  });
});

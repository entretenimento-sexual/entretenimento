import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCommunitySocialAccessEligible,
} from './community-social-access.service';

function eligibleUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-1',
    accountStatus: 'active',
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      acknowledgedPrivacyNotice: true,
    },
    adultConsent: {
      accepted: true,
      version: 'v1',
    },
    ageReverification: { status: 'NONE' },
    ...overrides,
  };
}

function eligibleAge(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-1',
    status: 'VERIFIED_ADULT',
    policyVersion: 1,
    source: 'AGE_REVERIFICATION',
    method: 'MANUAL_REVIEW',
    caseId: 'case-1',
    verifiedAtMs: Date.now() - 1_000,
    expiresAtMs: null,
    ...overrides,
  };
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

function errorReason(error: unknown): unknown {
  return (error as { details?: { reason?: unknown } }).details?.reason;
}

test('aceita conta social elegível sem exigir perfil completo', () => {
  assert.doesNotThrow(() =>
    assertCommunitySocialAccessEligible(
      eligibleUser({ profileCompleted: false }),
      'user-1',
      eligibleAge()
    )
  );
});

test('nega perfil divergente ou conta restrita', () => {
  assert.throws(
    () => assertCommunitySocialAccessEligible(
      eligibleUser(),
      'user-2',
      eligibleAge()
    ),
    (error: unknown) => errorCode(error) === 'not-found'
  );

  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ interactionBlocked: true }),
        'user-1',
        eligibleAge()
      ),
    (error: unknown) =>
      errorCode(error) === 'failed-precondition'
      && errorReason(error) === 'account_interaction_blocked'
  );
});

test('nega termos ausentes ou desatualizados', () => {
  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ acceptedTerms: { accepted: true, version: 'v2' } }),
        'user-1',
        eligibleAge()
      ),
    (error: unknown) =>
      errorCode(error) === 'failed-precondition'
      && errorReason(error) === 'terms_required'
  );
});

test('ignora idade client-side e usa somente decisão etária canônica', () => {
  assert.doesNotThrow(() =>
    assertCommunitySocialAccessEligible(
      eligibleUser({ idade: 17 }),
      'user-1',
      eligibleAge()
    )
  );

  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ idade: 30 }),
        'user-1',
        eligibleAge({
          status: 'DENIED_UNDERAGE',
          verifiedAtMs: null,
        })
      ),
    (error: unknown) =>
      errorCode(error) === 'permission-denied'
      && errorReason(error) === 'underage'
  );
});

test('nega reverificação pendente e consentimento adulto inválido', () => {
  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ ageReverification: { status: 'UNDER_REVIEW' } }),
        'user-1',
        eligibleAge()
      ),
    (error: unknown) => errorReason(error) === 'age_reverification_required'
  );

  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ adultConsent: { accepted: true, version: 'legacy' } }),
        'user-1',
        eligibleAge()
      ),
    (error: unknown) => errorReason(error) === 'adult_consent_required'
  );
});

test('não aceita bypass legado de consentimento inicial', () => {
  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({
          initialAdultConsentRequired: false,
          adultConsent: null,
        }),
        'user-1',
        eligibleAge()
      ),
    (error: unknown) => errorReason(error) === 'adult_consent_required'
  );
});

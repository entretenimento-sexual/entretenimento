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
      'user-1'
    )
  );
});

test('nega perfil divergente ou conta restrita', () => {
  assert.throws(
    () => assertCommunitySocialAccessEligible(
      eligibleUser(),
      'user-2'
    ),
    (error: unknown) => errorCode(error) === 'not-found'
  );

  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ interactionBlocked: true }),
        'user-1'
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
        'user-1'
      ),
    (error: unknown) =>
      errorCode(error) === 'failed-precondition'
      && errorReason(error) === 'terms_required'
  );
});

test('não usa idade ou assurance etário como gate social local', () => {
  for (const legacyAgeProjection of [
    null,
    {
      status: 'SELF_DECLARED_ADULT',
      policyVersion: 1,
    },
    {
      status: 'VERIFIED_ADULT',
      policyVersion: 1,
    },
    {
      status: 'DENIED_UNDERAGE',
      policyVersion: 1,
    },
  ]) {
    assert.doesNotThrow(() =>
      assertCommunitySocialAccessEligible(
        eligibleUser({
          idade: 17,
          ageEligibility: legacyAgeProjection,
        }),
        'user-1'
      )
    );
  }

  assert.doesNotThrow(() =>
    assertCommunitySocialAccessEligible(
      eligibleUser({ ageReverification: { status: 'UNDER_REVIEW' } }),
      'user-1'
    )
  );
});

test('nega consentimento adulto inválido', () => {
  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ adultConsent: { accepted: true, version: 'legacy' } }),
        'user-1'
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
        'user-1'
      ),
    (error: unknown) => errorReason(error) === 'adult_consent_required'
  );
});

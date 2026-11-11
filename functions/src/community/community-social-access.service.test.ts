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

test('aceita conta elegível sem consentimento v1 ou com histórico recusado ou inválido', () => {
  for (const adultConsent of [
    undefined,
    null,
    { accepted: false, version: 'v1' },
    { accepted: true, version: 'legacy' },
  ]) {
    assert.doesNotThrow(() =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ adultConsent }),
        'user-1'
      )
    );
  }
});

test('marcador de consentimento inicial é histórico, não um bypass de lifecycle', () => {
  for (const initialAdultConsentRequired of [undefined, false, true]) {
    assert.doesNotThrow(() =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ initialAdultConsentRequired, adultConsent: null }),
        'user-1'
      )
    );

    assert.throws(
      () => assertCommunitySocialAccessEligible(
        eligibleUser({
          initialAdultConsentRequired,
          adultConsent: null,
          interactionBlocked: true,
        }),
        'user-1'
      ),
      (error: unknown) =>
        errorCode(error) === 'failed-precondition' &&
        errorReason(error) === 'account_interaction_blocked'
    );
  }
});

test('hold de moderação e termos vigentes continuam obrigatórios sem consentimento v1', () => {
  assert.throws(
    () => assertCommunitySocialAccessEligible(
      eligibleUser({
        adultConsent: null,
        moderationAutomationHold: { active: true, expiresAtMs: Date.now() + 60_000 },
      }),
      'user-1'
    ),
    (error: unknown) =>
      errorCode(error) === 'failed-precondition' &&
      errorReason(error) === 'moderation_automation_hold'
  );

  assert.throws(
    () => assertCommunitySocialAccessEligible(
      eligibleUser({ adultConsent: null, acceptedTerms: null }),
      'user-1'
    ),
    (error: unknown) =>
      errorCode(error) === 'failed-precondition' &&
      errorReason(error) === 'terms_required'
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCommunitySocialAccessEligible,
} from './community-social-access.service';

function eligibleUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-1',
    accountStatus: 'active',
    idade: 30,
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      acknowledgedPrivacyNotice: true,
    },
    initialAdultConsentRequired: true,
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
    () => assertCommunitySocialAccessEligible(eligibleUser(), 'user-2'),
    (error: unknown) => errorCode(error) === 'not-found'
  );

  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ interactionBlocked: true }),
        'user-1'
      ),
    (error: unknown) =>
      errorCode(error) === 'permission-denied'
      && errorReason(error) === 'account_restricted'
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
      && errorReason(error) === 'current_terms_required'
  );
});

test('nega menor de idade e resultado UNDERAGE', () => {
  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ idade: 17 }),
        'user-1'
      ),
    (error: unknown) =>
      errorCode(error) === 'permission-denied'
      && errorReason(error) === 'adult_access_denied'
  );

  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({
          ageReverification: { status: 'VERIFIED', result: 'UNDERAGE' },
        }),
        'user-1'
      ),
    (error: unknown) => errorReason(error) === 'adult_access_denied'
  );
});

test('nega reverificação pendente e consentimento adulto inválido', () => {
  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ ageReverification: { status: 'UNDER_REVIEW' } }),
        'user-1'
      ),
    (error: unknown) => errorReason(error) === 'age_reverification_required'
  );

  assert.throws(
    () =>
      assertCommunitySocialAccessEligible(
        eligibleUser({ adultConsent: { accepted: true, version: 'legacy' } }),
        'user-1'
      ),
    (error: unknown) => errorReason(error) === 'adult_access_required'
  );
});

test('preserva compatibilidade quando consentimento inicial é explicitamente dispensado', () => {
  assert.doesNotThrow(() =>
    assertCommunitySocialAccessEligible(
      eligibleUser({
        initialAdultConsentRequired: false,
        adultConsent: null,
      }),
      'user-1'
    )
  );
});

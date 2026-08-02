import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePublicVideoAccountEligibility,
  isActiveUserBlock,
} from './public-video-audience-access.policy';

function eligibleUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: 'viewer-1',
    accountStatus: 'active',
    loginAllowed: true,
    emailVerified: true,
    profileCompleted: true,
    ...overrides,
  };
}

test('allows an operational legacy adult account', () => {
  assert.deepEqual(
    evaluatePublicVideoAccountEligibility(
      eligibleUser(),
      'viewer-1'
    ),
    { allowed: true, reason: null }
  );
});

test('accepts the authenticated email claim when the projection is stale', () => {
  assert.deepEqual(
    evaluatePublicVideoAccountEligibility(
      eligibleUser({ emailVerified: false }),
      'viewer-1',
      { authenticatedEmailVerified: true }
    ),
    { allowed: true, reason: null }
  );
});

test('requires adult consent and terms for versioned registrations', () => {
  assert.equal(
    evaluatePublicVideoAccountEligibility(
      eligibleUser({ initialAdultConsentRequired: true }),
      'viewer-1'
    ).reason,
    'adult_access_required'
  );

  assert.equal(
    evaluatePublicVideoAccountEligibility(
      eligibleUser({
        initialAdultConsentRequired: true,
        adultConsent: { accepted: true },
      }),
      'viewer-1'
    ).reason,
    'terms_required'
  );

  assert.deepEqual(
    evaluatePublicVideoAccountEligibility(
      eligibleUser({
        initialAdultConsentRequired: true,
        adultConsent: { accepted: true },
        acceptedTerms: { accepted: true },
      }),
      'viewer-1'
    ),
    { allowed: true, reason: null }
  );
});

test('blocks accounts under age reverification', () => {
  assert.equal(
    evaluatePublicVideoAccountEligibility(
      eligibleUser({
        ageReverification: { status: 'UNDER_REVIEW' },
      }),
      'viewer-1'
    ).reason,
    'adult_access_required'
  );
});

test('blocks restricted and incomplete accounts', () => {
  assert.equal(
    evaluatePublicVideoAccountEligibility(
      eligibleUser({ interactionBlocked: true }),
      'viewer-1'
    ).reason,
    'account_restricted'
  );

  assert.equal(
    evaluatePublicVideoAccountEligibility(
      eligibleUser({ profileCompleted: false }),
      'viewer-1'
    ).reason,
    'profile_incomplete'
  );
});

test('allows owner validation without requiring a projected email flag', () => {
  assert.deepEqual(
    evaluatePublicVideoAccountEligibility(
      eligibleUser({ emailVerified: undefined }),
      'viewer-1',
      { requireVerifiedEmail: false }
    ),
    { allowed: true, reason: null }
  );
});

test('recognizes only active block documents', () => {
  assert.equal(isActiveUserBlock({ isBlocked: true }), true);
  assert.equal(isActiveUserBlock({ isBlocked: false }), false);
  assert.equal(isActiveUserBlock(null), false);
});

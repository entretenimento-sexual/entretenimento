import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCommunityMembershipActorEligible,
} from './community-membership-eligibility.service';

function eligibleUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-1',
    accountStatus: 'active',
    profileCompleted: true,
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      acknowledgedPrivacyNotice: true,
    },
    adultConsent: { accepted: true, version: 'v1' },
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

test('aceita conta elegível no instante da revisão', () => {
  assert.doesNotThrow(() =>
    assertCommunityMembershipActorEligible(
      eligibleUser(),
      'user-1',
      eligibleAge()
    )
  );
});

test('nega perfil divergente, restrito, incompleto ou sem acesso adulto', () => {
  assert.throws(
    () => assertCommunityMembershipActorEligible(
      eligibleUser(),
      'user-2',
      eligibleAge()
    ),
    (error: unknown) =>
      (error as { code?: unknown }).code === 'not-found'
  );

  assert.throws(
    () =>
      assertCommunityMembershipActorEligible(
        eligibleUser({ accountStatus: 'moderation_suspended' }),
        'user-1',
        eligibleAge()
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code === 'failed-precondition'
  );

  assert.throws(
    () =>
      assertCommunityMembershipActorEligible(
        eligibleUser({ profileCompleted: false }),
        'user-1',
        eligibleAge()
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code === 'failed-precondition'
  );

  assert.throws(
    () =>
      assertCommunityMembershipActorEligible(
        eligibleUser({ adultConsent: { accepted: false, version: 'v1' } }),
        'user-1',
        eligibleAge()
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code === 'failed-precondition'
  );

  assert.throws(
    () =>
      assertCommunityMembershipActorEligible(
        eligibleUser(),
        'user-1',
        null
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code === 'failed-precondition'
  );
});

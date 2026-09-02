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
    idade: 30,
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      acknowledgedPrivacyNotice: true,
    },
    initialAdultConsentRequired: true,
    adultConsent: { accepted: true, version: 'v1' },
    ageReverification: { status: 'NONE' },
    ...overrides,
  };
}

test('aceita conta elegível no instante da revisão', () => {
  assert.doesNotThrow(() =>
    assertCommunityMembershipActorEligible(eligibleUser(), 'user-1')
  );
});

test('nega perfil divergente, restrito, incompleto ou sem acesso adulto', () => {
  assert.throws(
    () => assertCommunityMembershipActorEligible(eligibleUser(), 'user-2'),
    (error: unknown) =>
      (error as { code?: unknown }).code === 'not-found'
  );
  assert.throws(
    () =>
      assertCommunityMembershipActorEligible(
        eligibleUser({ accountStatus: 'moderation_suspended' }),
        'user-1'
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code === 'permission-denied'
  );
  assert.throws(
    () =>
      assertCommunityMembershipActorEligible(
        eligibleUser({ profileCompleted: false }),
        'user-1'
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code === 'failed-precondition'
  );
  assert.throws(
    () =>
      assertCommunityMembershipActorEligible(
        eligibleUser({ adultConsent: { accepted: false, version: 'v1' } }),
        'user-1'
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code === 'failed-precondition'
  );
});

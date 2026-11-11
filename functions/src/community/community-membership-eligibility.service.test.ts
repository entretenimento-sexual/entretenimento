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
    ageReverification: { status: 'NONE' },
    ...overrides,
  };
}

test('aceita conta elegível no instante da revisão', () => {
  assert.doesNotThrow(() =>
    assertCommunityMembershipActorEligible(
      eligibleUser(),
      'user-1'
    )
  );
});

test('nega perfil divergente, restrito ou incompleto sem reavaliar assurance etário', () => {
  assert.throws(
    () => assertCommunityMembershipActorEligible(
      eligibleUser(),
      'user-2'
    ),
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
      (error as { code?: unknown }).code === 'failed-precondition'
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

  assert.doesNotThrow(() =>
    assertCommunityMembershipActorEligible(
      eligibleUser({
        ageEligibility: {
          status: 'DENIED_UNDERAGE',
          assurance: 'legacy_projection_only',
        },
      }),
      'user-1'
    )
  );
});


test('membership ignora consentimento v1, mas preserva perfil, lifecycle e termos', () => {
  for (const adultConsent of [
    undefined,
    null,
    { accepted: false, version: 'v1' },
    { accepted: true, version: 'legacy' },
  ]) {
    const legacy = eligibleUser({
      initialAdultConsentRequired: true,
      adultConsent,
    });

    assert.doesNotThrow(() =>
      assertCommunityMembershipActorEligible(legacy, 'user-1')
    );

    for (const restrictions of [
      { profileCompleted: false },
      { interactionBlocked: true },
      { accountStatus: 'moderation_suspended' },
      { acceptedTerms: null },
    ]) {
      assert.throws(
        () => assertCommunityMembershipActorEligible(
          { ...legacy, ...restrictions },
          'user-1'
        ),
        (error: unknown) =>
          (error as { code?: unknown }).code === 'failed-precondition'
      );
    }
  }
});

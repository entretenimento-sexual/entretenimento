import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCommunityMembershipActorEligible,
  isCommunityMembershipEntitlementAllowed,
  resolveCommunityMembershipRequirement,
} from './community-membership-eligibility.service';

function eligibleUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-1',
    accountStatus: 'active',
    profileCompleted: true,
    idade: 30,
    initialAdultConsentRequired: true,
    adultConsent: { accepted: true },
    ageReverification: { status: 'NONE' },
    ...overrides,
  };
}

function activeEntitlement(overrides: Record<string, unknown> = {}) {
  const now = Date.now();

  return {
    id: 'platform_subscription_user-1',
    buyerUid: 'user-1',
    sellerUid: null,
    scope: 'platform_subscription',
    planId: 'premium-monthly',
    planKey: 'premium',
    grantedRole: 'premium',
    active: true,
    startsAt: now - 60_000,
    endsAt: now + 60_000,
    sourceCheckoutSessionId: 'checkout-1',
    sourcePaymentTransactionId: 'transaction-1',
    createdAt: now - 60_000,
    updatedAt: now - 30_000,
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
        eligibleUser({ adultConsent: { accepted: false } }),
        'user-1'
      ),
    (error: unknown) =>
      (error as { code?: unknown }).code === 'failed-precondition'
  );
});

test('resolve requisito comunitário sem conhecer processador financeiro', () => {
  assert.deepEqual(
    resolveCommunityMembershipRequirement({
      access: {
        contentAccess: {
          minimumRole: 'premium',
          requiresActiveSubscription: true,
        },
      },
    }),
    { minimumRole: 'premium', requiresEntitlement: true }
  );

  assert.deepEqual(resolveCommunityMembershipRequirement({ access: {} }), {
    minimumRole: 'basic',
    requiresEntitlement: false,
  });
});

test('revalida entitlement ativo, usuário e nível mínimo', () => {
  const requirement = {
    minimumRole: 'premium' as const,
    requiresEntitlement: true,
  };

  assert.equal(
    isCommunityMembershipEntitlementAllowed(
      activeEntitlement(),
      'user-1',
      requirement
    ),
    true
  );
  assert.equal(
    isCommunityMembershipEntitlementAllowed(
      activeEntitlement({ grantedRole: 'basic' }),
      'user-1',
      requirement
    ),
    false
  );
  assert.equal(
    isCommunityMembershipEntitlementAllowed(
      activeEntitlement({ buyerUid: 'user-2' }),
      'user-1',
      requirement
    ),
    false
  );
  assert.equal(
    isCommunityMembershipEntitlementAllowed(
      activeEntitlement({ endsAt: Date.now() - 1 }),
      'user-1',
      requirement
    ),
    false
  );
});

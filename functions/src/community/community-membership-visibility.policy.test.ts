import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCommunityMembershipProfileVisibilityState,
  resolveCommunityMembershipVisibility,
} from './community-membership-visibility.policy';

function buildCommunity(overrides: Record<string, unknown> = {}) {
  return {
    visibility: 'public_preview',
    status: 'active',
    moderation: { state: 'active' },
    membershipDisclosure: {
      profileMembership: 'opt_in',
      policyVersion: 2,
    },
    ...overrides,
  };
}

function buildMembership(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    profileVisibility: 'visible',
    profileVisibilityPolicyVersion: 2,
    ...overrides,
  };
}

test('permite somente Comunidade pública e membro com opt-in da mesma policy', () => {
  assert.deepEqual(
    resolveCommunityMembershipVisibility(buildCommunity(), buildMembership()),
    { visible: true, reason: 'eligible' }
  );
});

test('mantém participação privada quando política de disclosure está ausente', () => {
  const community = buildCommunity({ membershipDisclosure: undefined });

  assert.deepEqual(
    resolveCommunityMembershipVisibility(community, buildMembership()),
    { visible: false, reason: 'community_disclosure_disabled' }
  );
});

test('rejeita policy de disclosure sem versão válida', () => {
  assert.deepEqual(
    resolveCommunityMembershipVisibility(
      buildCommunity({
        membershipDisclosure: {
          profileMembership: 'opt_in',
          policyVersion: 0,
        },
      }),
      buildMembership()
    ),
    { visible: false, reason: 'community_disclosure_policy_invalid' }
  );
});

test('não expõe membership de Comunidade members_only ou hidden', () => {
  assert.equal(
    resolveCommunityMembershipVisibility(
      buildCommunity({ visibility: 'members_only' }),
      buildMembership()
    ).visible,
    false
  );
  assert.equal(
    resolveCommunityMembershipVisibility(
      buildCommunity({ visibility: 'hidden' }),
      buildMembership()
    ).visible,
    false
  );
});

test('não expõe Comunidade inativa ou sob moderação', () => {
  assert.deepEqual(
    resolveCommunityMembershipVisibility(
      buildCommunity({ status: 'paused' }),
      buildMembership()
    ),
    { visible: false, reason: 'community_not_active' }
  );
  assert.deepEqual(
    resolveCommunityMembershipVisibility(
      buildCommunity({ moderation: { state: 'pending_review' } }),
      buildMembership()
    ),
    { visible: false, reason: 'community_not_moderation_active' }
  );
});

test('não expõe membership inativo nem ausência de opt-in do membro', () => {
  assert.deepEqual(
    resolveCommunityMembershipVisibility(
      buildCommunity(),
      buildMembership({ status: 'left' })
    ),
    { visible: false, reason: 'membership_not_active' }
  );
  assert.deepEqual(
    resolveCommunityMembershipVisibility(
      buildCommunity(),
      buildMembership({ profileVisibility: undefined })
    ),
    { visible: false, reason: 'member_not_opted_in' }
  );
});

test('não reutiliza consentimento concedido para versão antiga da policy', () => {
  assert.deepEqual(
    resolveCommunityMembershipVisibility(
      buildCommunity(),
      buildMembership({ profileVisibilityPolicyVersion: 1 })
    ),
    { visible: false, reason: 'consent_policy_mismatch' }
  );
});

test('estado privado exige novo opt-in após mudança de policy', () => {
  assert.deepEqual(
    resolveCommunityMembershipProfileVisibilityState(
      buildCommunity(),
      buildMembership({ profileVisibilityPolicyVersion: 1 })
    ),
    {
      disclosureMode: 'opt_in',
      policyVersion: 2,
      profileVisibility: 'hidden',
      profileVisibilityPolicyVersion: null,
      canChange: true,
    }
  );
});

test('estado privado mantém legacy hidden e desabilita mudança sem policy', () => {
  assert.deepEqual(
    resolveCommunityMembershipProfileVisibilityState(
      buildCommunity({ membershipDisclosure: undefined }),
      { status: 'active' }
    ),
    {
      disclosureMode: 'disabled',
      policyVersion: 1,
      profileVisibility: 'hidden',
      profileVisibilityPolicyVersion: null,
      canChange: false,
    }
  );
});

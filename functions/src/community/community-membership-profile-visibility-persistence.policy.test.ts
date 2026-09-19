import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCommunityMembershipProfileVisibilityState,
  resolveCommunityMembershipProfileVisibilityState,
} from './community-membership-visibility.policy';

const community = {
  visibility: 'public_preview',
  status: 'active',
  moderation: { state: 'active' },
  membershipDisclosure: {
    profileMembership: 'opt_in',
    policyVersion: 2,
  },
};

test('classifica estados persistidos de visibilidade sem coerção', () => {
  assert.deepEqual(
    classifyCommunityMembershipProfileVisibilityState({ status: 'active' }),
    { kind: 'legacy_hidden' }
  );
  assert.deepEqual(
    classifyCommunityMembershipProfileVisibilityState({
      status: 'active',
      profileVisibility: 'hidden',
      profileVisibilityPolicyVersion: null,
    }),
    { kind: 'hidden' }
  );
  assert.deepEqual(
    classifyCommunityMembershipProfileVisibilityState({
      status: 'active',
      profileVisibility: 'hidden',
    }),
    { kind: 'hidden' }
  );
  assert.deepEqual(
    classifyCommunityMembershipProfileVisibilityState({
      status: 'active',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 2,
    }),
    { kind: 'visible', policyVersion: 2 }
  );

  for (const membership of [
    {
      status: 'active',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: '2',
    },
    {
      status: 'active',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 2.5,
    },
    {
      status: 'active',
      profileVisibility: 'visible',
    },
    {
      status: 'active',
      profileVisibility: 'hidden',
      profileVisibilityPolicyVersion: 2,
    },
    {
      status: 'active',
      profileVisibility: 'unexpected',
      profileVisibilityPolicyVersion: null,
    },
    {
      status: 'active',
      profileVisibilityPolicyVersion: null,
    },
  ]) {
    assert.deepEqual(
      classifyCommunityMembershipProfileVisibilityState(membership),
      { kind: 'invalid' }
    );
  }
});

test('estado resolvido não permite novo opt-in quando consentimento persistido está corrompido', () => {
  for (const membership of [
    {
      status: 'active',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: '2',
    },
    {
      status: 'active',
      profileVisibility: 'hidden',
      profileVisibilityPolicyVersion: 2,
    },
    {
      status: 'active',
      profileVisibility: 'unexpected',
      profileVisibilityPolicyVersion: null,
    },
  ]) {
    assert.equal(
      resolveCommunityMembershipProfileVisibilityState(
        community,
        membership
      ).canChange,
      false
    );
  }
});

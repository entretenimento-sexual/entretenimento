import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCommunityMembershipVisibility,
} from './community-membership-visibility.policy';

const community = {
  visibility: 'public_preview',
  status: 'active',
  moderation: { state: 'active' },
  membershipDisclosure: {
    profileMembership: 'opt_in',
    policyVersion: 3,
  },
};

test('perfil público exige consentimento explícito da versão atual', () => {
  assert.equal(
    resolveCommunityMembershipVisibility(community, {
      status: 'active',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 3,
    }).visible,
    true
  );

  for (const membership of [
    { status: 'active' },
    { status: 'active', profileVisibility: 'hidden' },
    {
      status: 'active',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 2,
    },
    {
      status: 'left',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 3,
    },
  ]) {
    assert.equal(
      resolveCommunityMembershipVisibility(community, membership).visible,
      false
    );
  }
});

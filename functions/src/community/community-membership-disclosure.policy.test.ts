import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCommunityMembershipDisclosureTransition,
} from './community-membership-disclosure.policy';

test('legacy ausente começa disabled e habilitação avança a versão', () => {
  assert.deepEqual(
    resolveCommunityMembershipDisclosureTransition({}, 'opt_in'),
    {
      currentMode: 'disabled',
      currentPolicyVersion: 1,
      nextMode: 'opt_in',
      nextPolicyVersion: 2,
      updated: true,
    }
  );
});

test('mudança de policy invalida consentimentos antigos por nova versão', () => {
  const community = {
    membershipDisclosure: {
      profileMembership: 'opt_in',
      policyVersion: 4,
    },
  };

  assert.equal(
    resolveCommunityMembershipDisclosureTransition(community, 'disabled')
      .nextPolicyVersion,
    5
  );
});

test('operação idempotente preserva a versão atual', () => {
  const community = {
    membershipDisclosure: {
      profileMembership: 'opt_in',
      policyVersion: 3,
    },
  };

  assert.deepEqual(
    resolveCommunityMembershipDisclosureTransition(community, 'opt_in'),
    {
      currentMode: 'opt_in',
      currentPolicyVersion: 3,
      nextMode: 'opt_in',
      nextPolicyVersion: 3,
      updated: false,
    }
  );
});

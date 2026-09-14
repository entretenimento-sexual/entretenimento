import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  resolveCommunityMembershipProfileVisibilityState,
  resolveCommunityMembershipVisibility,
} from './community-membership-visibility.policy';

function community() {
  return {
    visibility: 'public_preview',
    status: 'active',
    moderation: { state: 'active' },
    membershipDisclosure: {
      profileMembership: 'opt_in',
      policyVersion: 2,
    },
  };
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    profileVisibility: 'visible',
    profileVisibilityPolicyVersion: 2,
    joinedAt: 2_000,
    profileVisibilityUpdatedAt: 1_000,
    ...overrides,
  };
}

test('reentrada não reutiliza consentimento público de ciclo anterior', () => {
  const staleConsent = membership();

  assert.deepEqual(
    resolveCommunityMembershipVisibility(community(), staleConsent),
    { visible: false, reason: 'consent_predates_membership_cycle' }
  );
  assert.deepEqual(
    resolveCommunityMembershipProfileVisibilityState(community(), staleConsent),
    {
      disclosureMode: 'opt_in',
      policyVersion: 2,
      profileVisibility: 'hidden',
      profileVisibilityPolicyVersion: null,
      canChange: true,
    }
  );
});

test('opt-in feito no ciclo atual permanece elegível', () => {
  assert.deepEqual(
    resolveCommunityMembershipVisibility(
      community(),
      membership({ profileVisibilityUpdatedAt: 2_000 })
    ),
    { visible: true, reason: 'eligible' }
  );
});

test('novo opt-in não trata consentimento stale como já aplicado', () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      'src/community/community-membership-profile-visibility.handler.ts'
    ),
    'utf8'
  );

  assert.match(
    source,
    /command\.profileVisibility === 'visible'\s*\? state\.profileVisibility === 'visible'/,
    'O handler deve persistir novo timestamp quando o opt-in pertence a ciclo anterior.'
  );
});

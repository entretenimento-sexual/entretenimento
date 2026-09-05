import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCommunityOfficialClaimCapability,
} from './community-official-claim-capability.policy';
import {
  resolveCommunityOfficialClaimSubmission,
} from './community-official-claim-submission.policy';

const NOW = 1_800_000_000_000;

function activeGrant() {
  return {
    holderUid: 'user-1',
    scope: 'official_space_creation',
    verificationStatus: 'verified',
    policyVersion: 1,
    organizationId: 'organization-1',
    maxOfficialSpaces: 10,
    active: true,
    startsAt: NOW - 1_000,
    endsAt: NOW + 10_000,
  };
}

function capability(rawVenue: Readonly<Record<string, unknown>>) {
  return resolveCommunityOfficialClaimCapability({
    actorUid: 'user-1',
    rawGrant: activeGrant(),
    rawVenues: [rawVenue],
    communityAlreadyOfficial: false,
    now: NOW,
  });
}

function submission(rawVenue: Readonly<Record<string, unknown>>) {
  return resolveCommunityOfficialClaimSubmission({
    actorUid: 'user-1',
    intent: {
      requestId: 'request-1',
      communityId: 'community-1',
      target: { type: 'venue', id: 'venue-1' },
      associationKey: 'venue:venue-1',
    },
    rawGrant: activeGrant(),
    rawTarget: rawVenue,
    now: NOW,
  });
}

for (const scenario of [
  {
    name: 'owner',
    rawVenue: {
      id: 'venue-1',
      name: 'Local Owner',
      status: 'active',
      ownerUid: 'user-1',
      adminUids: [],
    },
    expectedRole: 'owner' as const,
  },
  {
    name: 'manager',
    rawVenue: {
      id: 'venue-1',
      name: 'Local Manager',
      status: 'active',
      ownerUid: 'owner-1',
      adminUids: ['user-1'],
    },
    expectedRole: 'manager' as const,
  },
]) {
  test(`capability e submit concordam sobre autoridade ${scenario.name}`, () => {
    const capabilityDecision = capability(scenario.rawVenue);
    const submissionDecision = submission(scenario.rawVenue);

    assert.equal(capabilityDecision.canSubmit, true);
    assert.equal(
      capabilityDecision.candidates[0]?.authorityRole,
      scenario.expectedRole
    );
    assert.equal(
      submissionDecision.command?.authorityRole,
      scenario.expectedRole
    );
  });
}

test('capability e submit falham fechado para usuário sem autoridade no Local', () => {
  const rawVenue = {
    id: 'venue-1',
    name: 'Local de terceiro',
    status: 'active',
    ownerUid: 'owner-1',
    adminUids: [],
  };

  const capabilityDecision = capability(rawVenue);
  const submissionDecision = submission(rawVenue);

  assert.equal(capabilityDecision.canSubmit, false);
  assert.equal(capabilityDecision.reason, 'no_eligible_target');
  assert.equal(submissionDecision.command, null);
  assert.equal(
    submissionDecision.denialReason,
    'target_authority_mismatch'
  );
});

test('capability e submit falham fechado para Local inativo', () => {
  const rawVenue = {
    id: 'venue-1',
    name: 'Local pausado',
    status: 'paused',
    ownerUid: 'user-1',
    adminUids: [],
  };

  const capabilityDecision = capability(rawVenue);
  const submissionDecision = submission(rawVenue);

  assert.equal(capabilityDecision.canSubmit, false);
  assert.equal(capabilityDecision.reason, 'no_eligible_target');
  assert.equal(submissionDecision.command, null);
  assert.equal(submissionDecision.denialReason, 'target_inactive');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCommunityOfficialClaimCapability,
} from './community-official-claim-capability.policy';
import {
  evaluateOrganizationOfficialClaimAuthority,
} from './community-official-claim-evidence.policy';
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

test('capability, submit e evidência concordam sobre representação da Organização', () => {
  const rawOrganization = {
    organizationId: 'organization-1',
    displayName: 'Organização Um',
    status: 'active',
    countryCode: 'BR',
  };
  const rawKyb = {
    organizationId: 'organization-1',
    status: 'verified',
    policyVersion: 2,
    verifiedAt: NOW - 10_000,
    revalidationDueAt: NOW + 20_000,
    expiresAt: NOW + 30_000,
    revokedAt: null,
  };
  const rawRepresentation = {
    organizationId: 'organization-1',
    holderUid: 'user-1',
    role: 'legal_representative',
    scopes: ['community_official_claim'],
    status: 'active',
    startsAt: NOW - 10_000,
    endsAt: NOW + 30_000,
    revokedAt: null,
  };

  const capabilityDecision = resolveCommunityOfficialClaimCapability({
    actorUid: 'user-1',
    rawGrant: null,
    rawVenues: [],
    rawOrganizationAuthorities: [{
      organizationId: 'organization-1',
      rawOrganization,
      rawKyb,
      rawRepresentation,
    }],
    activeOfficialOrganizationIds: [],
    communityAlreadyOfficial: false,
    now: NOW,
  });
  const submissionDecision = resolveCommunityOfficialClaimSubmission({
    actorUid: 'user-1',
    intent: {
      requestId: 'request-organization-1',
      communityId: 'community-1',
      target: { type: 'organization', id: 'organization-1' },
      associationKey: 'organization:organization-1',
    },
    rawTarget: rawOrganization,
    rawOrganizationKyb: rawKyb,
    rawOrganizationRepresentation: rawRepresentation,
    organizationRepresentationReferenceId: 'organization-1:user-1',
    now: NOW,
  });

  assert.equal(capabilityDecision.canSubmit, true);
  assert.deepEqual(capabilityDecision.candidates[0], {
    target: { type: 'organization', id: 'organization-1' },
    label: 'Organização Um',
    authorityRole: 'authorized_representative',
  });
  assert.equal(
    submissionDecision.command?.authorityRole,
    'authorized_representative'
  );
  assert.equal(
    submissionDecision.command?.sponsorOrganizationId,
    'organization-1'
  );

  const evidenceDecision = evaluateOrganizationOfficialClaimAuthority({
    claimantUid: 'user-1',
    organizationId: 'organization-1',
    authorityRole: submissionDecision.command?.authorityRole
      ?? 'authorized_representative',
    sponsorOrganizationId:
      submissionDecision.command?.sponsorOrganizationId ?? null,
    kybReferenceId: 'organization-1',
    authorityReferenceId: 'organization-1:user-1',
    rawOrganization,
    rawKyb,
    rawRepresentation,
    now: NOW,
  });

  assert.equal(evidenceDecision.allowed, true);
  assert.equal(evidenceDecision.sponsorOrganizationId, 'organization-1');
  assert.equal(evidenceDecision.verificationPolicyVersion, 2);
});

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

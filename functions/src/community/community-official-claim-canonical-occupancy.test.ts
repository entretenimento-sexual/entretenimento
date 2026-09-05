import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCommunityOfficialClaimCapability,
} from './community-official-claim-capability.policy';
import {
  resolveCanonicalOfficialCommunityReferenceFromAssociation,
} from './official-communities.query';

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

function venue() {
  return {
    id: 'venue-1',
    name: 'Local Um',
    status: 'active',
    ownerUid: 'user-1',
    adminUids: [],
    officialAssociationKey: 'venue:venue-1',
  };
}

test('projeção stale no Local não bloqueia quando a associação canônica está livre', () => {
  const result = resolveCommunityOfficialClaimCapability({
    actorUid: 'user-1',
    rawGrant: activeGrant(),
    rawVenues: [venue()],
    activeOfficialVenueIds: [],
    communityAlreadyOfficial: false,
    now: NOW,
  });

  assert.equal(result.canSubmit, true);
  assert.equal(result.candidates[0]?.target.id, 'venue-1');
});

test('associação canônica ativa bloqueia o Local mesmo sem depender da projeção', () => {
  const result = resolveCommunityOfficialClaimCapability({
    actorUid: 'user-1',
    rawGrant: activeGrant(),
    rawVenues: [{ ...venue(), officialAssociationKey: null }],
    activeOfficialVenueIds: ['venue-1'],
    communityAlreadyOfficial: false,
    now: NOW,
  });

  assert.equal(result.canSubmit, false);
  assert.equal(result.reason, 'no_eligible_target');
  assert.deepEqual(result.candidates, []);
});

test('validador genérico aceita somente associação canônica atual e consistente', () => {
  const validAssociation = {
    associationKey: 'venue:venue-1',
    communityId: 'community-1',
    target: { type: 'venue', id: 'venue-1' },
    status: 'verified',
    verification: { expiresAt: null },
  };

  assert.deepEqual(
    resolveCanonicalOfficialCommunityReferenceFromAssociation(validAssociation),
    {
      associationKey: 'venue:venue-1',
      communityId: 'community-1',
      target: { type: 'venue', id: 'venue-1' },
    }
  );

  assert.equal(
    resolveCanonicalOfficialCommunityReferenceFromAssociation({
      ...validAssociation,
      status: 'revoked',
    }),
    null
  );

  assert.equal(
    resolveCanonicalOfficialCommunityReferenceFromAssociation({
      ...validAssociation,
      associationKey: 'venue:venue-other',
    }),
    null
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCommunityOfficialClaimCapability,
} from './community-official-claim-capability.policy';

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

test('expõe somente Local ativo em que o solicitante possui autoridade canônica', () => {
  const result = resolveCommunityOfficialClaimCapability({
    actorUid: 'user-1',
    rawGrant: activeGrant(),
    communityAlreadyOfficial: false,
    now: NOW,
    rawVenues: [
      {
        id: 'venue-1',
        name: 'Casa Um',
        status: 'active',
        ownerUid: 'user-1',
        adminUids: [],
      },
      {
        id: 'venue-2',
        name: 'Casa Dois',
        status: 'active',
        ownerUid: 'outro-user',
        adminUids: ['user-1'],
      },
      {
        id: 'venue-3',
        name: 'Já oficial',
        status: 'active',
        ownerUid: 'user-1',
        officialAssociationKey: 'venue:venue-3',
      },
      {
        id: 'venue-4',
        name: 'Inativo',
        status: 'paused',
        ownerUid: 'user-1',
      },
    ],
  });

  assert.equal(result.canSubmit, true);
  assert.equal(result.reason, 'eligible');
  assert.deepEqual(result.candidates, [
    {
      target: { type: 'venue', id: 'venue-1' },
      label: 'Casa Um',
      authorityRole: 'owner',
    },
    {
      target: { type: 'venue', id: 'venue-2' },
      label: 'Casa Dois',
      authorityRole: 'manager',
    },
  ]);
});

test('falha fechado quando verificação comercial não está ativa', () => {
  const result = resolveCommunityOfficialClaimCapability({
    actorUid: 'user-1',
    rawGrant: { ...activeGrant(), active: false },
    communityAlreadyOfficial: false,
    now: NOW,
    rawVenues: [],
  });

  assert.equal(result.canSubmit, false);
  assert.equal(result.reason, 'verification_inactive');
  assert.deepEqual(result.candidates, []);
});

test('não oferece nova reivindicação para Comunidade já oficial', () => {
  const result = resolveCommunityOfficialClaimCapability({
    actorUid: 'user-1',
    rawGrant: activeGrant(),
    communityAlreadyOfficial: true,
    now: NOW,
    rawVenues: [],
  });

  assert.equal(result.canSubmit, false);
  assert.equal(result.reason, 'community_already_official');
});

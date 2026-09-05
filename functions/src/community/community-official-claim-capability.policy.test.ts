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

function organizationAuthority(overrides: {
  organization?: Record<string, unknown>;
  kyb?: Record<string, unknown> | null;
  representation?: Record<string, unknown> | null;
} = {}) {
  return {
    organizationId: 'organization-1',
    rawOrganization: {
      organizationId: 'organization-1',
      displayName: 'Organização Um',
      status: 'active',
      countryCode: 'BR',
      ...overrides.organization,
    },
    rawKyb: overrides.kyb === null
      ? null
      : {
        organizationId: 'organization-1',
        status: 'verified',
        policyVersion: 2,
        verifiedAt: NOW - 10_000,
        revalidationDueAt: NOW + 20_000,
        expiresAt: NOW + 30_000,
        revokedAt: null,
        ...overrides.kyb,
      },
    rawRepresentation: overrides.representation === null
      ? null
      : {
        organizationId: 'organization-1',
        holderUid: 'user-1',
        role: 'legal_representative',
        scopes: ['community_official_claim'],
        status: 'active',
        startsAt: NOW - 10_000,
        endsAt: NOW + 30_000,
        revokedAt: null,
        ...overrides.representation,
      },
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

test('expõe Organização somente com KYB e representação escopada vigentes', () => {
  const result = resolveCommunityOfficialClaimCapability({
    actorUid: 'user-1',
    rawGrant: null,
    rawVenues: [],
    rawOrganizationAuthorities: [organizationAuthority()],
    activeOfficialOrganizationIds: [],
    communityAlreadyOfficial: false,
    now: NOW,
  });

  assert.equal(result.canSubmit, true);
  assert.equal(result.reason, 'eligible');
  assert.deepEqual(result.candidates, [
    {
      target: { type: 'organization', id: 'organization-1' },
      label: 'Organização Um',
      authorityRole: 'authorized_representative',
    },
  ]);
});

test('não expõe Organização com KYB expirado ou revogado', () => {
  for (const status of ['expired', 'revoked'] as const) {
    const result = resolveCommunityOfficialClaimCapability({
      actorUid: 'user-1',
      rawGrant: null,
      rawVenues: [],
      rawOrganizationAuthorities: [organizationAuthority({ kyb: { status } })],
      activeOfficialOrganizationIds: [],
      communityAlreadyOfficial: false,
      now: NOW,
    });

    assert.equal(result.canSubmit, false);
    assert.equal(result.reason, 'verification_inactive');
    assert.deepEqual(result.candidates, []);
  }
});

test('não expõe Organização sem representação válida ou sem escopo', () => {
  for (const representation of [
    null,
    { status: 'revoked' },
    { scopes: ['manage_organization'] },
    { holderUid: 'user-2' },
  ]) {
    const result = resolveCommunityOfficialClaimCapability({
      actorUid: 'user-1',
      rawGrant: null,
      rawVenues: [],
      rawOrganizationAuthorities: [organizationAuthority({
        representation,
      })],
      activeOfficialOrganizationIds: [],
      communityAlreadyOfficial: false,
      now: NOW,
    });

    assert.equal(result.canSubmit, false);
    assert.deepEqual(result.candidates, []);
  }
});

test('não oferece Organização que já possui associação oficial ativa', () => {
  const result = resolveCommunityOfficialClaimCapability({
    actorUid: 'user-1',
    rawGrant: null,
    rawVenues: [],
    rawOrganizationAuthorities: [organizationAuthority()],
    activeOfficialOrganizationIds: ['organization-1'],
    communityAlreadyOfficial: false,
    now: NOW,
  });

  assert.equal(result.canSubmit, false);
  assert.deepEqual(result.candidates, []);
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

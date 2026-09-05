import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCommunityOfficialClaimSubmission } from './community-official-claim-submission.policy';

const NOW = 1_800_000_000_000;
const venueIntent = {
  requestId: 'request-1',
  communityId: 'community-1',
  target: { type: 'venue' as const, id: 'venue-1' },
  associationKey: 'venue:venue-1',
};
const organizationIntent = {
  requestId: 'request-2',
  communityId: 'community-1',
  target: { type: 'organization' as const, id: 'organization-1' },
  associationKey: 'organization:organization-1',
};

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

function activeOrganization(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'organization-1',
    displayName: 'Organização Um',
    status: 'active',
    countryCode: 'BR',
    ...overrides,
  };
}

function verifiedKyb(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'organization-1',
    status: 'verified',
    policyVersion: 2,
    verifiedAt: NOW - 10_000,
    revalidationDueAt: NOW + 20_000,
    expiresAt: NOW + 30_000,
    revokedAt: null,
    ...overrides,
  };
}

function activeRepresentation(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'organization-1',
    holderUid: 'user-1',
    role: 'legal_representative',
    scopes: ['community_official_claim'],
    status: 'active',
    startsAt: NOW - 10_000,
    endsAt: NOW + 30_000,
    revokedAt: null,
    ...overrides,
  };
}

function submitOrganization(overrides: Partial<Parameters<
  typeof resolveCommunityOfficialClaimSubmission
>[0]> = {}) {
  return resolveCommunityOfficialClaimSubmission({
    actorUid: 'user-1',
    intent: organizationIntent,
    rawTarget: activeOrganization(),
    rawOrganizationKyb: verifiedKyb(),
    rawOrganizationRepresentation: activeRepresentation(),
    organizationRepresentationReferenceId: 'organization-1:user-1',
    now: NOW,
    ...overrides,
  });
}

test('deriva organização, papel e evidência do Local sem confiar no cliente', () => {
  const result = resolveCommunityOfficialClaimSubmission({
    actorUid: 'user-1',
    intent: venueIntent,
    rawGrant: activeGrant(),
    rawTarget: {
      status: 'active',
      ownerUid: 'user-1',
      adminUids: [],
    },
    now: NOW,
  });

  assert.deepEqual(result, {
    command: {
      ...venueIntent,
      authorityRole: 'owner',
      sponsorOrganizationId: 'organization-1',
      evidenceReferences: [
        { type: 'authority_record', referenceId: 'user-1' },
      ],
    },
    denialReason: null,
  });
});

test('deriva manager para administrador ativo do Local', () => {
  const result = resolveCommunityOfficialClaimSubmission({
    actorUid: 'user-1',
    intent: venueIntent,
    rawGrant: activeGrant(),
    rawTarget: {
      status: 'active',
      ownerUid: 'outro-user',
      adminUids: ['user-1'],
    },
    now: NOW,
  });

  assert.equal(result.command?.authorityRole, 'manager');
});

test('deriva Organização por KYB e representação canônica escopada', () => {
  const result = submitOrganization();

  assert.deepEqual(result, {
    command: {
      ...organizationIntent,
      authorityRole: 'authorized_representative',
      sponsorOrganizationId: 'organization-1',
      evidenceReferences: [
        {
          type: 'organization_kyb_record',
          referenceId: 'organization-1',
        },
        {
          type: 'authority_record',
          referenceId: 'organization-1:user-1',
        },
      ],
    },
    denialReason: null,
  });
});

test('Organização falha fechado sem KYB vigente', () => {
  for (const rawOrganizationKyb of [
    null,
    verifiedKyb({ status: 'pending' }),
    verifiedKyb({ status: 'rejected' }),
  ]) {
    const result = submitOrganization({ rawOrganizationKyb });
    assert.equal(result.command, null);
    assert.equal(result.denialReason, 'verification_required');
  }

  for (const rawOrganizationKyb of [
    verifiedKyb({ status: 'expired' }),
    verifiedKyb({ status: 'revoked' }),
    verifiedKyb({ expiresAt: NOW }),
    verifiedKyb({ revalidationDueAt: NOW }),
  ]) {
    const result = submitOrganization({ rawOrganizationKyb });
    assert.equal(result.command, null);
    assert.equal(result.denialReason, 'verification_inactive');
  }
});

test('Organização falha fechado para representação inválida ou sem escopo', () => {
  const cases = [
    null,
    activeRepresentation({ status: 'revoked' }),
    activeRepresentation({ endsAt: NOW }),
    activeRepresentation({ startsAt: NOW + 1 }),
    activeRepresentation({ holderUid: 'user-2' }),
    activeRepresentation({ organizationId: 'organization-2' }),
    activeRepresentation({ scopes: ['manage_organization'] }),
  ];

  for (const rawOrganizationRepresentation of cases) {
    const result = submitOrganization({ rawOrganizationRepresentation });
    assert.equal(result.command, null);
    assert.equal(result.denialReason, 'target_authority_mismatch');
  }
});

test('Organização falha fechado para referência de representação divergente', () => {
  const result = submitOrganization({
    organizationRepresentationReferenceId: 'organization-1:user-2',
  });

  assert.equal(result.command, null);
  assert.equal(result.denialReason, 'target_authority_mismatch');
});

test('falha fechado para alvo sem fonte canônica ou sem autoridade', () => {
  assert.equal(
    resolveCommunityOfficialClaimSubmission({
      actorUid: 'user-1',
      intent: {
        ...venueIntent,
        target: { type: 'profile', id: 'profile-1' },
        associationKey: 'profile:profile-1',
      },
      rawGrant: activeGrant(),
      rawTarget: null,
      now: NOW,
    }).denialReason,
    'unsupported_target'
  );

  assert.equal(
    resolveCommunityOfficialClaimSubmission({
      actorUid: 'user-1',
      intent: venueIntent,
      rawGrant: activeGrant(),
      rawTarget: {
        status: 'active',
        ownerUid: 'outro-user',
        adminUids: [],
      },
      now: NOW,
    }).denialReason,
    'target_authority_mismatch'
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCanonicalResourceAuthority,
} from './canonical-resource-authority.resolver';

const NOW = 1_800_000_000_000;

function activeGrant(overrides: Record<string, unknown> = {}) {
  return {
    holderUid: 'user-1',
    organizationId: 'organization-1',
    verificationStatus: 'verified',
    active: true,
    startsAt: NOW - 1_000,
    endsAt: NOW + 10_000,
    ...overrides,
  };
}

function organizationKyb(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'organization-1',
    status: 'verified',
    policyVersion: 1,
    verifiedAt: NOW - 1_000,
    revalidationDueAt: NOW + 10_000,
    expiresAt: NOW + 20_000,
    revokedAt: null,
    ...overrides,
  };
}

function organizationRepresentation(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'organization-1',
    holderUid: 'user-1',
    role: 'legal_representative',
    scopes: ['community_official_claim'],
    status: 'active',
    startsAt: NOW - 1_000,
    endsAt: NOW + 10_000,
    revokedAt: null,
    ...overrides,
  };
}

test('resolve owner do Local a partir das fontes canônicas', () => {
  const result = resolveCanonicalResourceAuthority({
    actorUid: 'user-1',
    targetType: 'venue',
    targetId: 'venue-1',
    rawCommercialGrant: activeGrant(),
    rawTarget: {
      status: 'active',
      ownerUid: 'user-1',
      adminUids: [],
    },
    now: NOW,
  });

  assert.deepEqual(result, {
    allowed: true,
    targetType: 'venue',
    targetId: 'venue-1',
    organizationId: 'organization-1',
    authorityUid: 'user-1',
    authorityRole: 'owner',
    denialReason: null,
  });
});

test('resolve manager do Local sem promover role comunitária', () => {
  const result = resolveCanonicalResourceAuthority({
    actorUid: 'user-1',
    targetType: 'venue',
    targetId: 'venue-1',
    rawCommercialGrant: activeGrant(),
    rawTarget: {
      status: 'active',
      ownerUid: 'owner-1',
      adminUids: ['user-1'],
    },
    now: NOW,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.authorityRole, 'manager');
});

test('resolve Organização por KYB + representação canônica escopada', () => {
  const result = resolveCanonicalResourceAuthority({
    actorUid: 'user-1',
    targetType: 'organization',
    targetId: 'organization-1',
    rawTarget: {
      organizationId: 'organization-1',
      status: 'active',
    },
    rawOrganizationKyb: organizationKyb(),
    rawOrganizationRepresentation: organizationRepresentation(),
    requiredOrganizationScope: 'community_official_claim',
    now: NOW,
  });

  assert.deepEqual(result, {
    allowed: true,
    targetType: 'organization',
    targetId: 'organization-1',
    organizationId: 'organization-1',
    authorityUid: 'user-1',
    authorityRole: 'authorized_representative',
    denialReason: null,
  });
});

test('Organização falha fechado com KYB inativo ou representação sem escopo', () => {
  assert.equal(resolveCanonicalResourceAuthority({
    actorUid: 'user-1',
    targetType: 'organization',
    targetId: 'organization-1',
    rawTarget: { organizationId: 'organization-1', status: 'active' },
    rawOrganizationKyb: organizationKyb({ status: 'revoked' }),
    rawOrganizationRepresentation: organizationRepresentation(),
    requiredOrganizationScope: 'community_official_claim',
    now: NOW,
  }).denialReason, 'verification_inactive');

  assert.equal(resolveCanonicalResourceAuthority({
    actorUid: 'user-1',
    targetType: 'organization',
    targetId: 'organization-1',
    rawTarget: { organizationId: 'organization-1', status: 'active' },
    rawOrganizationKyb: organizationKyb(),
    rawOrganizationRepresentation: organizationRepresentation({
      scopes: ['manage_organization'],
    }),
    requiredOrganizationScope: 'community_official_claim',
    now: NOW,
  }).denialReason, 'target_authority_mismatch');
});

test('falha fechado para tipos ainda sem fonte canônica', () => {
  for (const targetType of ['profile', 'event'] as const) {
    assert.equal(
      resolveCanonicalResourceAuthority({
        actorUid: 'user-1',
        targetType,
        targetId: `${targetType}-1`,
        rawCommercialGrant: activeGrant(),
        rawTarget: null,
        now: NOW,
      }).denialReason,
      'unsupported_target'
    );
  }
});

test('rejeita Local inativo ou usuário sem autoridade no recurso', () => {
  assert.equal(
    resolveCanonicalResourceAuthority({
      actorUid: 'user-1',
      targetType: 'venue',
      targetId: 'venue-1',
      rawCommercialGrant: activeGrant(),
      rawTarget: {
        status: 'inactive',
        ownerUid: 'user-1',
        adminUids: [],
      },
      now: NOW,
    }).denialReason,
    'target_inactive'
  );

  assert.equal(
    resolveCanonicalResourceAuthority({
      actorUid: 'user-1',
      targetType: 'venue',
      targetId: 'venue-1',
      rawCommercialGrant: activeGrant(),
      rawTarget: {
        status: 'active',
        ownerUid: 'owner-1',
        adminUids: [],
      },
      now: NOW,
    }).denialReason,
    'target_authority_mismatch'
  );
});

test('rejeita autoridade comercial expirada antes de avaliar o Local', () => {
  assert.equal(
    resolveCanonicalResourceAuthority({
      actorUid: 'user-1',
      targetType: 'venue',
      targetId: 'venue-1',
      rawCommercialGrant: activeGrant({ endsAt: NOW }),
      rawTarget: {
        status: 'active',
        ownerUid: 'user-1',
        adminUids: [],
      },
      now: NOW,
    }).denialReason,
    'verification_inactive'
  );
});

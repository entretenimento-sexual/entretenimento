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

test('falha fechado para tipos ainda sem fonte canônica', () => {
  for (const targetType of ['profile', 'organization', 'event'] as const) {
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

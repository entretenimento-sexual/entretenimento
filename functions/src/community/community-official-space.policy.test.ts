import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateOfficialSpaceCreationGrant,
} from './community-official-space.policy';

const NOW = 1_800_000_000_000;

function activeGrant(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

test('mantém capacidade comunitária separada da autoridade comercial', () => {
  assert.deepEqual(
    evaluateOfficialSpaceCreationGrant({
      actorUid: 'user-1',
      actorUserRole: null,
      rawGrant: activeGrant(),
      now: NOW,
    }),
    {
      allowed: true,
      organizationId: 'organization-1',
      maxOfficialSpaces: 10,
      memberLimit: 1000,
      denialReason: null,
    }
  );
});

test('rejeita concessão comercial válida sem capability de Espaço Oficial', () => {
  assert.equal(
    evaluateOfficialSpaceCreationGrant({
      actorUid: 'user-1',
      actorUserRole: null,
      rawGrant: activeGrant({ scope: 'outra_capability' }),
      now: NOW,
    }).denialReason,
    'verification_required'
  );
});

test('preserva bypass explícito da administração da plataforma', () => {
  const result = evaluateOfficialSpaceCreationGrant({
    actorUid: 'admin-1',
    actorUserRole: 'admin',
    rawGrant: null,
    now: NOW,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.organizationId, 'platform-administration');
  assert.equal(result.maxOfficialSpaces, null);
});

test('mapeia autoridade comercial expirada para grant_inactive', () => {
  assert.equal(
    evaluateOfficialSpaceCreationGrant({
      actorUid: 'user-1',
      actorUserRole: null,
      rawGrant: activeGrant({ endsAt: NOW }),
      now: NOW,
    }).denialReason,
    'grant_inactive'
  );
});

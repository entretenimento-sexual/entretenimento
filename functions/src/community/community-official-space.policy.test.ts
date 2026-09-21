import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateOfficialSpaceCreationGrant,
  OFFICIAL_SPACE_CREATION_POLICY_VERSION,
} from './community-official-space.policy';

const NOW = 1_800_000_000_000;

function activeAuthority(overrides: Record<string, unknown> = {}) {
  return {
    holderUid: 'user-1',
    scope: 'verified_commercial_authority',
    verificationStatus: 'verified',
    policyVersion: OFFICIAL_SPACE_CREATION_POLICY_VERSION,
    organizationId: 'organization-1',
    active: true,
    startsAt: NOW - 1_000,
    endsAt: NOW + 10_000,
    ...overrides,
  };
}

test('grant de Espaço Oficial valida somente autoridade comercial', () => {
  assert.deepEqual(
    evaluateOfficialSpaceCreationGrant({
      actorUid: 'user-1',
      actorUserRole: null,
      rawGrant: activeAuthority(),
      now: NOW,
    }),
    {
      allowed: true,
      organizationId: 'organization-1',
      denialReason: null,
    }
  );
});

test('rejeita capacidade, preço ou plano dentro do vínculo de autoridade', () => {
  for (const rawGrant of [
    activeAuthority({ memberLimit: 250 }),
    activeAuthority({ maxOfficialSpaces: 3 }),
    activeAuthority({ planKey: 'business' }),
    activeAuthority({ amountCents: 9999 }),
  ]) {
    assert.equal(
      evaluateOfficialSpaceCreationGrant({
        actorUid: 'user-1',
        actorUserRole: null,
        rawGrant,
        now: NOW,
      }).denialReason,
      'verification_required'
    );
  }
});

test('plano pessoal não cria autoridade comercial', () => {
  assert.equal(
    evaluateOfficialSpaceCreationGrant({
      actorUid: 'user-1',
      actorUserRole: 'vip',
      rawGrant: null,
      now: NOW,
    }).denialReason,
    'verification_required'
  );
});

test('preserva bypass explícito de autoridade administrativa, sem conceder capacidade', () => {
  assert.deepEqual(
    evaluateOfficialSpaceCreationGrant({
      actorUid: 'admin-1',
      actorUserRole: 'admin',
      rawGrant: null,
      now: NOW,
    }),
    {
      allowed: true,
      organizationId: 'platform-administration',
      denialReason: null,
    }
  );
});

test('mapeia autoridade comercial expirada para grant_inactive', () => {
  assert.equal(
    evaluateOfficialSpaceCreationGrant({
      actorUid: 'user-1',
      actorUserRole: null,
      rawGrant: activeAuthority({ endsAt: NOW }),
      now: NOW,
    }).denialReason,
    'grant_inactive'
  );
});

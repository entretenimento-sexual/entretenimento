import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCanonicalResourceAuthorityRoleForTarget,
  normalizeCanonicalAuthorityResourceId,
  normalizeCanonicalAuthorityTargetType,
  normalizeCanonicalResourceAuthorityRole,
} from './canonical-resource-authority.model';

test('normaliza uma única taxonomia canônica de alvo e papel', () => {
  for (const targetType of ['profile', 'organization', 'venue', 'event'] as const) {
    assert.equal(normalizeCanonicalAuthorityTargetType(targetType), targetType);
  }

  for (const role of [
    'self',
    'owner',
    'authorized_representative',
    'manager',
    'organizer',
    'promoter',
  ] as const) {
    assert.equal(normalizeCanonicalResourceAuthorityRole(role), role);
  }

  assert.equal(normalizeCanonicalAuthorityTargetType('local'), null);
  assert.equal(normalizeCanonicalResourceAuthorityRole('admin'), null);
});

test('centraliza o contrato de identificador de recurso', () => {
  assert.equal(normalizeCanonicalAuthorityResourceId(' venue-1 '), 'venue-1');
  assert.equal(normalizeCanonicalAuthorityResourceId('venue inválido'), null);
  assert.equal(normalizeCanonicalAuthorityResourceId('a'.repeat(129)), null);
});

test('mantém papel real separado do papel comunitário e por tipo de alvo', () => {
  assert.equal(isCanonicalResourceAuthorityRoleForTarget('profile', 'self'), true);
  assert.equal(isCanonicalResourceAuthorityRoleForTarget('profile', 'owner'), false);
  assert.equal(isCanonicalResourceAuthorityRoleForTarget('venue', 'manager'), true);
  assert.equal(
    isCanonicalResourceAuthorityRoleForTarget('organization', 'authorized_representative'),
    true
  );
  assert.equal(isCanonicalResourceAuthorityRoleForTarget('event', 'organizer'), true);
  assert.equal(isCanonicalResourceAuthorityRoleForTarget('event', 'promoter'), true);
  assert.equal(isCanonicalResourceAuthorityRoleForTarget('event', 'owner'), false);
});

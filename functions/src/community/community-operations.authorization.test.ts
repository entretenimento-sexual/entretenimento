// functions/src/community/community-operations.authorization.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { hasCommunityOperationsPermission } from './community-operations.authorization';
import { hasCommunityPurgeOperationsPermission } from './community-purge-operations.authorization';

test('admin e superadmin possuem capability operacional', () => {
  assert.equal(
    hasCommunityOperationsPermission({ admin: true }, 'community:ranking'),
    true
  );
  assert.equal(
    hasCommunityOperationsPermission(
      { staffRoles: ['superadmin'] },
      'community:purge'
    ),
    true
  );
});

test('permissão especializada libera somente capability solicitada', () => {
  const subject = { permissions: ['community:ranking'] };

  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:ranking'),
    true
  );
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:purge'),
    false
  );
});

test('community lifecycle continua como capability operacional ampla', () => {
  const subject = { permissions: ['community:lifecycle'] };

  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:ranking'),
    true
  );
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:purge'),
    true
  );
});

test('moderador comum não recebe acesso operacional', () => {
  assert.equal(
    hasCommunityOperationsPermission(
      { roles: ['moderator'] },
      'community:ranking'
    ),
    false
  );
});

test('wrapper de purge preserva contrato existente', () => {
  assert.equal(
    hasCommunityPurgeOperationsPermission({ permissions: ['community:purge'] }),
    true
  );
  assert.equal(
    hasCommunityPurgeOperationsPermission({ roles: ['moderator'] }),
    false
  );
});

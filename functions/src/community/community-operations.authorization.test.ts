// functions/src/community/community-operations.authorization.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { hasCommunityOperationsPermission } from './community-operations.authorization';
import { hasCommunityPurgeOperationsPermission } from './community-purge-operations.authorization';

test('admin e superadmin não recebem capability operacional implícita', () => {
  for (const subject of [
    { admin: true },
    { superadmin: true },
    { roles: ['admin'] },
    { roles: ['superadmin'] },
    { staffRoles: ['admin'] },
    { staffRoles: ['superadmin'] },
  ]) {
    assert.equal(
      hasCommunityOperationsPermission(subject, 'community:ranking'),
      false
    );
    assert.equal(
      hasCommunityOperationsPermission(subject, 'community:purge'),
      false
    );
    assert.equal(
      hasCommunityOperationsPermission(subject, 'community:reconcile'),
      false
    );
  }
});

test('admin com capability explícita recebe somente a capability declarada', () => {
  const subject = {
    admin: true,
    permissions: ['community:ranking'],
  };

  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:ranking'),
    true
  );
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:purge'),
    false
  );
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:reconcile'),
    false
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
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:reconcile'),
    false
  );
});

test('community lifecycle não autoriza operações especializadas', () => {
  const subject = { permissions: ['community:lifecycle'] };

  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:lifecycle'),
    true
  );
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:ranking'),
    false
  );
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:purge'),
    false
  );
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:reconcile'),
    false
  );
});

test('community purge libera somente purge', () => {
  const subject = { permissions: ['community:purge'] };

  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:purge'),
    true
  );
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:ranking'),
    false
  );
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:reconcile'),
    false
  );
});

test('reconciliação exige capability explícita', () => {
  const subject = { permissions: ['community:reconcile'] };

  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:reconcile'),
    true
  );
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:ranking'),
    false
  );
  assert.equal(
    hasCommunityOperationsPermission(subject, 'community:purge'),
    false
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
  assert.equal(
    hasCommunityOperationsPermission(
      { roles: ['moderator'] },
      'community:reconcile'
    ),
    false
  );
});

test('wrapper de purge exige capability explícita', () => {
  assert.equal(
    hasCommunityPurgeOperationsPermission({ permissions: ['community:purge'] }),
    true
  );
  assert.equal(
    hasCommunityPurgeOperationsPermission({ admin: true }),
    false
  );
  assert.equal(
    hasCommunityPurgeOperationsPermission({ roles: ['moderator'] }),
    false
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { currentStaffPermissionAllows } from './_shared';

function hasAccountDeletionOperationsPermission(user: Record<string, unknown> | null): boolean {
  return currentStaffPermissionAllows(user, 'users:deletion-operations');
}

test('allows admin and superadmin roles', () => {
  assert.equal(
    hasAccountDeletionOperationsPermission({ admin: true }),
    true
  );
  assert.equal(
    hasAccountDeletionOperationsPermission({ roles: ['superadmin'] }),
    true
  );
});

test('allows explicit lifecycle or deletion permissions', () => {
  assert.equal(
    hasAccountDeletionOperationsPermission({
      permissions: ['users:delete'],
    }),
    true
  );
  assert.equal(
    hasAccountDeletionOperationsPermission({
      permissions: ['users:lifecycle'],
    }),
    true
  );
});

test('denies moderator without explicit permission', () => {
  assert.equal(
    hasAccountDeletionOperationsPermission({ moderator: true }),
    false
  );
  assert.equal(
    hasAccountDeletionOperationsPermission({ roles: ['moderator'] }),
    false
  );
});

test('denies malformed or empty authorization state', () => {
  assert.equal(hasAccountDeletionOperationsPermission(null), false);
  assert.equal(
    hasAccountDeletionOperationsPermission({ permissions: 'users:delete' }),
    false
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { currentStaffPermissionAllows } from './_shared';

const permission = 'users:suspend' as const;

test('concessão por role admin autoriza e revogação nega mesmo com JWT antigo', () => {
  const staleJwt = { admin: true, roles: ['admin'] };
  const granted = { accountStatus: 'active', role: 'admin' };
  const revoked = { accountStatus: 'active', role: 'free' };
  assert.equal(currentStaffPermissionAllows(granted, permission), true);
  assert.equal(currentStaffPermissionAllows(revoked, permission), false);
  // O JWT permanece intacto; não participa da decisão canônica.
  assert.equal(staleJwt.admin, true);
  assert.equal(currentStaffPermissionAllows(granted, permission), true);
});

test('permissão granular é válida e sua revogação tem efeito imediato', () => {
  assert.equal(currentStaffPermissionAllows({ permissions: ['users:suspend'] }, permission), true);
  assert.equal(currentStaffPermissionAllows({ permissions: [] }, permission), false);
  assert.equal(currentStaffPermissionAllows(null, permission), false);
});

test('lifecycle bloqueado prevalece sobre privilégios elevados', () => {
  for (const state of [
    { suspended: true },
    { accountLocked: true },
    { interactionBlocked: true },
    { loginAllowed: false },
    { accountStatus: 'moderation_suspended' },
  ]) {
    assert.equal(currentStaffPermissionAllows({ role: 'admin', ...state }, permission), false);
  }
});

test('restauração de privilégio volta a autorizar sem mudar a decisão sobre token', () => {
  const revoked = { accountStatus: 'active', role: 'free' };
  const restored = { accountStatus: 'active', role: 'admin' };
  assert.equal(currentStaffPermissionAllows(revoked, permission), false);
  assert.equal(currentStaffPermissionAllows(restored, permission), true);
});

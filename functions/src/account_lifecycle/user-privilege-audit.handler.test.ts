import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminPrivilegeAuditId,
  resolveAdminPrivilegeTransition,
} from './user-privilege-audit.handler';

const NOW = 1_800_000_000_000;

test('detecta concessão de admin', () => {
  assert.equal(
    resolveAdminPrivilegeTransition({
      beforeRole: 'free',
      afterRole: 'admin',
    }),
    'admin_granted'
  );
});

test('detecta revogação de admin', () => {
  assert.equal(
    resolveAdminPrivilegeTransition({
      beforeRole: 'admin',
      afterRole: 'premium',
    }),
    'admin_revoked'
  );
});

test('ignora mudanças financeiras que não alteram privilégio admin', () => {
  assert.equal(
    resolveAdminPrivilegeTransition({
      beforeRole: 'basic',
      afterRole: 'premium',
    }),
    null
  );
});

test('id de auditoria é determinístico e ordena mais recente primeiro', () => {
  const newer = buildAdminPrivilegeAuditId({
    uid: 'user-1',
    eventId: 'event-2',
    occurredAt: NOW + 10_000,
  });
  const older = buildAdminPrivilegeAuditId({
    uid: 'user-1',
    eventId: 'event-1',
    occurredAt: NOW,
  });
  const same = buildAdminPrivilegeAuditId({
    uid: 'user-1',
    eventId: 'event-2',
    occurredAt: NOW + 10_000,
  });

  assert.equal(newer, same);
  assert.ok(newer < older);
});

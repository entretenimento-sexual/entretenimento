import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertAdminAuthorization,
  resolveAdminAuthorization,
} from './admin-authorization.policy';

describe('admin-authorization.policy', () => {
  it('aceita a claim booleana admin', () => {
    assert.deepEqual(
      resolveAdminAuthorization({
        uid: 'admin_1',
        token: { admin: true },
      }),
      {
        adminUid: 'admin_1',
        allowed: true,
        source: 'admin',
      }
    );
  });

  it('aceita role e roles com normalização textual', () => {
    assert.equal(
      resolveAdminAuthorization({
        uid: 'admin_2',
        token: { role: ' ADMIN ' },
      }).source,
      'role'
    );
    assert.equal(
      resolveAdminAuthorization({
        uid: 'admin_3',
        token: { roles: ['moderator', 'Admin'] },
      }).source,
      'roles'
    );
  });

  it('não aceita coerção booleana nem roles não textuais', () => {
    assert.equal(
      resolveAdminAuthorization({
        uid: 'user_1',
        token: { admin: 'true', role: true, roles: [true, 1] },
      }).allowed,
      false
    );
  });

  it('rejeita identidade administrativa inválida como não autenticada', () => {
    assert.throws(
      () => assertAdminAuthorization(
        { uid: '../admin', token: { admin: true } },
        'Operação restrita.'
      ),
      (error: unknown) => {
        const candidate = error as { code?: unknown; message?: unknown };
        return candidate.code === 'unauthenticated' &&
          candidate.message === 'Administrador não autenticado.';
      }
    );
  });

  it('preserva a mensagem de permissão do domínio', () => {
    assert.throws(
      () => assertAdminAuthorization(
        { uid: 'user_2', token: {} },
        'Apenas administradores podem revisar esta fila.'
      ),
      (error: unknown) => {
        const candidate = error as { code?: unknown; message?: unknown };
        return candidate.code === 'permission-denied' &&
          candidate.message ===
            'Apenas administradores podem revisar esta fila.';
      }
    );
  });
});

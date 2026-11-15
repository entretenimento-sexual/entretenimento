import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseAdminUserDetailRequest,
} from './admin-user-detail.policy';

import {
  buildAdminUsersPage,
} from './admin-users-page.policy';

describe('Admin user detail privacy boundary', () => {
  it('accepts only an exact valid UID request', () => {
    assert.deepEqual(
      parseAdminUserDetailRequest({
        uid: 'synthetic_user-01',
      }),
      { uid: 'synthetic_user-01' }
    );
  });

  it('rejects malformed UID and extra fields', () => {
    for (const input of [
      null,
      undefined,
      {},
      [],
      'synthetic_user',
      { uid: '' },
      { uid: ' user_1' },
      { uid: 'user_1 ' },
      { uid: 'users/user_1' },
      { uid: 'user@example.invalid' },
      { uid: 123 },
      {
        uid: 'user_1',
        email: 'private@example.invalid',
      },
      {
        uid: 'user_1',
        payment: 'private',
      },
    ]) {
      assert.equal(
        parseAdminUserDetailRequest(input),
        null
      );
    }
  });

  it('reuses the safe administrative projection', () => {
    const page = buildAdminUsersPage(
      [{
        id: 'synthetic_user_1',
        data: {
          nickname: 'safe-nickname',
          profileCompleted: true,
          accountStatus: 'active',
          suspended: false,
          accountLocked: false,
          interactionBlocked: false,
          loginAllowed: true,

          // Synthetic forbidden fields.
          email: 'private@example.invalid',
          nome: 'PRIVATE LEGAL NAME',
          cpf: 'PRIVATE_CPF',
          telefone: 'PRIVATE_PHONE',
          paymentMethod: 'PRIVATE_PAYMENT',
          billing: {
            secret: 'PRIVATE_BILLING',
          },
        },
      }],
      1
    );

    const row = page.items[0];

    assert.ok(row);
    assert.equal(row.uid, 'synthetic_user_1');

    assert.deepEqual(
      Object.keys(row).sort(),
      [
        'uid',
        'nickname',
        'profileCompleted',
        'accountStatus',
        'suspended',
        'accountLocked',
        'interactionBlocked',
        'loginAllowed',
      ].sort()
    );

    const serialized = JSON.stringify(row);

    for (const forbidden of [
      'private@example.invalid',
      'PRIVATE LEGAL NAME',
      'PRIVATE_CPF',
      'PRIVATE_PHONE',
      'PRIVATE_PAYMENT',
      'PRIVATE_BILLING',
    ]) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        'Unexpected private field: ' + forbidden
      );
    }
  });

  it('does not expose email-like nicknames', () => {
    const page = buildAdminUsersPage(
      [{
        id: 'synthetic_user_2',
        data: {
          nickname: 'private@example.invalid',
          profileCompleted: true,
          accountStatus: 'active',
          suspended: false,
          accountLocked: false,
          interactionBlocked: false,
          loginAllowed: true,
        },
      }],
      1
    );

    const serialized = JSON.stringify(
      page.items[0]
    );

    assert.equal(
      serialized.includes('private@example.invalid'),
      false
    );
  });
});

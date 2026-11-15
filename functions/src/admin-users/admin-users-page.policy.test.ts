import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminUsersPage,
  parseAdminUsersPageRequest,
  projectAdminUserRow
} from './admin-users-page.policy';

test('returns only allowed operational fields', () => {
  const row = projectAdminUserRow('user_1', {
    nickname: 'social-profile',
    profileCompleted: true,
    accountStatus: 'active',
    suspended: false,
    accountLocked: false,
    interactionBlocked: false,
    loginAllowed: true,

    email: 'private@example.invalid',
    nome: 'PRIVATE LEGAL NAME',
    cpf: '00000000000',
    phone: 'PRIVATE PHONE',
    paymentMethod: 'PRIVATE PAYMENT',
    bankAccount: 'PRIVATE BANK',
    billingAddress: 'PRIVATE ADDRESS'
  });

  assert.deepEqual(row, {
    uid: 'user_1',
    nickname: 'social-profile',
    profileCompleted: true,
    accountStatus: 'active',
    suspended: false,
    accountLocked: false,
    interactionBlocked: false,
    loginAllowed: true
  });

  const serialized = JSON.stringify(row);

  for (const secret of [
    'private@example.invalid',
    'PRIVATE LEGAL NAME',
    '00000000000',
    'PRIVATE PHONE',
    'PRIVATE PAYMENT',
    'PRIVATE BANK',
    'PRIVATE ADDRESS'
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('does not promote an email-like nickname', () => {
  const row = projectAdminUserRow('user_2', {
    nickname: 'private@example.invalid'
  });

  assert.equal(row.nickname, null);
  assert.equal(row.accountStatus, 'unknown');
});

test('validates page size and cursor', () => {
  assert.deepEqual(
    parseAdminUsersPageRequest(undefined),
    { cursor: null, limit: 25 }
  );

  assert.deepEqual(
    parseAdminUsersPageRequest({
      cursor: 'user_1',
      limit: 10
    }),
    { cursor: 'user_1', limit: 10 }
  );

  for (const invalid of [
    { limit: 0 },
    { limit: 51 },
    { limit: '50' },
    { cursor: 'invalid/path' },
    { cursor: '' },
    { unknown: true },
    []
  ]) {
    assert.equal(parseAdminUsersPageRequest(invalid), null);
  }
});

test('paginates without returning raw documents', () => {
  const documents = [
    {
      id: 'user_1',
      data: {
        nickname: 'social-1',
        email: 'private1@example.invalid'
      }
    },
    {
      id: 'user_2',
      data: {
        nickname: 'social-2',
        email: 'private2@example.invalid'
      }
    },
    {
      id: 'user_3',
      data: {
        nickname: 'social-3',
        email: 'private3@example.invalid'
      }
    }
  ];

  const page = buildAdminUsersPage(documents, 2);

  assert.equal(page.items.length, 2);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, 'user_2');

  assert.equal(
    JSON.stringify(page).includes('private1@example.invalid'),
    false
  );

  const finalPage = buildAdminUsersPage(
    documents.slice(2),
    2
  );

  assert.equal(finalPage.hasMore, false);
  assert.equal(finalPage.nextCursor, null);
});

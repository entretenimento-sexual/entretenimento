import { describe, expect, it } from 'vitest';

import {
  normalizeAdminUsersPageRequest,
  parseAdminUsersPageResponse,
} from './admin-users-page.model';

const user = {
  uid: 'synthetic_user_1',
  nickname: 'social-user',
  profileCompleted: true,
  accountStatus: 'active',
  suspended: false,
  accountLocked: false,
  interactionBlocked: false,
  loginAllowed: true,
};

describe('Admin users page contract', () => {
  it('normalizes page requests', () => {
    expect(normalizeAdminUsersPageRequest()).toEqual({
      cursor: null,
      limit: 25,
    });

    expect(normalizeAdminUsersPageRequest({
      cursor: 'synthetic_user_1',
      limit: 50,
    })).toEqual({
      cursor: 'synthetic_user_1',
      limit: 50,
    });
  });

  it('rejects invalid requests', () => {
    for (const input of [
      { limit: 0 },
      { limit: 51 },
      { limit: -1 },
      { limit: 1.5 },
      { cursor: 'unsafe/path' },
      { cursor: '' },
    ]) {
      expect(() =>
        normalizeAdminUsersPageRequest(input)
      ).toThrow();
    }
  });

  it('accepts a safe page', () => {
    const result = parseAdminUsersPageResponse({
      items: [user],
      hasMore: true,
      nextCursor: user.uid,
    }, 25);

    expect(result.items).toEqual([user]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(user.uid);
  });

  it('rejects unexpected private fields', () => {
    expect(() => parseAdminUsersPageResponse({
      items: [{
        ...user,
        email: 'private@example.invalid',
        cpf: 'private-cpf',
      }],
      hasMore: false,
      nextCursor: null,
    }, 25)).toThrow();

    expect(() => parseAdminUsersPageResponse({
      items: [user],
      hasMore: false,
      nextCursor: null,
      paymentHistory: 'private',
    }, 25)).toThrow();
  });

  it('rejects invalid pagination and duplicated IDs', () => {
    for (const payload of [
      {
        items: [user, user],
        hasMore: false,
        nextCursor: null,
      },
      {
        items: [user],
        hasMore: true,
        nextCursor: 'other_user',
      },
      {
        items: [],
        hasMore: true,
        nextCursor: 'synthetic_user_1',
      },
      {
        items: [user],
        hasMore: false,
        nextCursor: user.uid,
      },
    ]) {
      expect(() =>
        parseAdminUsersPageResponse(payload, 25)
      ).toThrow();
    }
  });

  it('rejects incomplete rows and registration-like nicknames', () => {
    const { loginAllowed, ...incomplete } = user;

    expect(() => parseAdminUsersPageResponse({
      items: [incomplete],
      hasMore: false,
      nextCursor: null,
    }, 25)).toThrow();

    expect(() => parseAdminUsersPageResponse({
      items: [{
        ...user,
        nickname: 'private@example.invalid',
      }],
      hasMore: false,
      nextCursor: null,
    }, 25)).toThrow();
  });
});

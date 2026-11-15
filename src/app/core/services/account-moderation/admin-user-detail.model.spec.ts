import { describe, expect, it } from 'vitest';
import {
  parseAdminUserDetailResponse,
} from './admin-users-page.model';

const safeRow = {
  uid: 'synthetic_1',
  nickname: 'nickname',
  profileCompleted: true,
  accountStatus: 'active',
  suspended: false,
  accountLocked: false,
  interactionBlocked: false,
  loginAllowed: true,
};

describe('Admin user detail response contract', () => {
  it('accepts the exact safe projection', () => {
    expect(parseAdminUserDetailResponse(safeRow)).toEqual(safeRow);
  });

  it('accepts null for a missing user', () => {
    expect(parseAdminUserDetailResponse(null)).toBeNull();
  });

  it('rejects private fields', () => {
    for (const field of ['email', 'nome', 'cpf', 'payment']) {
      expect(() => parseAdminUserDetailResponse({
        ...safeRow,
        [field]: 'PRIVATE',
      })).toThrow();
    }
  });

  it('rejects malformed operational states', () => {
    expect(() => parseAdminUserDetailResponse({
      ...safeRow,
      suspended: 'false',
    })).toThrow();

    expect(() => parseAdminUserDetailResponse({
      ...safeRow,
      accountStatus: 'invalid',
    })).toThrow();
  });
});

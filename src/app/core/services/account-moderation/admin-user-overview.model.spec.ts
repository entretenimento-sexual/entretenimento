import { describe, expect, it } from 'vitest';

import {
  parseAdminUserOverview,
} from './admin-user-overview.model';

const valid = {
  totalUsers: 8,
  completedProfiles: 3,
  incompleteProfiles: 5,
  restrictedUsers: 2,
  onlineUsers: 3,
  subscribers: 2,
};

describe('AdminUserOverview contract', () => {
  it('accepts valid aggregate counts', () => {
    expect(parseAdminUserOverview(valid)).toEqual(valid);
  });

  it('rejects private registration fields', () => {
    expect(() => parseAdminUserOverview({
      ...valid,
      email: 'private@example.invalid',
    })).toThrow();
  });

  it('rejects missing response fields', () => {
    const {
      subscribers: _removed,
      ...incomplete
    } = valid;

    expect(() =>
      parseAdminUserOverview(incomplete)
    ).toThrow();
  });

  it('rejects negative and fractional counts', () => {
    expect(() => parseAdminUserOverview({
      ...valid,
      subscribers: -1,
    })).toThrow();

    expect(() => parseAdminUserOverview({
      ...valid,
      subscribers: 1.5,
    })).toThrow();
  });

  it('rejects contradictory totals', () => {
    expect(() => parseAdminUserOverview({
      ...valid,
      incompleteProfiles: 4,
    })).toThrow();

    expect(() => parseAdminUserOverview({
      ...valid,
      restrictedUsers: 9,
    })).toThrow();
  });

  it('rejects invalid response formats', () => {
    for (const input of [null, [], '', 0]) {
      expect(() =>
        parseAdminUserOverview(input)
      ).toThrow();
    }
  });
});

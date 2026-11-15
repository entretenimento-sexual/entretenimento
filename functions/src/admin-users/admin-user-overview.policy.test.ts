import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAdminUserOverview,
} from './admin-user-overview.policy';

describe('Administrative user aggregates', () => {
  it('builds global totals without individual data', () => {
    const result = buildAdminUserOverview({
      totalUsers: 100,
      completedProfiles: 70,
      restrictedUsers: 12,
      onlineUsers: 9,
      subscribers: 20,
    });

    assert.deepEqual(result, {
      totalUsers: 100,
      completedProfiles: 70,
      incompleteProfiles: 30,
      restrictedUsers: 12,
      onlineUsers: 9,
      subscribers: 20,
    });

    for (const privateField of [
      'email',
      'nome',
      'cpf',
      'telefone',
      'paymentMethod',
      'subscriptionStatus',
      'billing',
    ]) {
      assert.equal(
        Object.hasOwn(result, privateField),
        false
      );
    }
  });

  it('accepts an empty user population', () => {
    assert.deepEqual(buildAdminUserOverview({
      totalUsers: 0,
      completedProfiles: 0,
      restrictedUsers: 0,
      onlineUsers: 0,
      subscribers: 0,
    }), {
      totalUsers: 0,
      completedProfiles: 0,
      incompleteProfiles: 0,
      restrictedUsers: 0,
      onlineUsers: 0,
      subscribers: 0,
    });
  });

  it('rejects inconsistent completed profiles', () => {
    assert.throws(() => buildAdminUserOverview({
      totalUsers: 2,
      completedProfiles: 3,
      restrictedUsers: 0,
      onlineUsers: 0,
      subscribers: 0,
    }));
  });

  it('rejects invalid and partial counts', () => {
    const original = {
      totalUsers: 10,
      completedProfiles: 5,
      restrictedUsers: 2,
      onlineUsers: 3,
      subscribers: 4,
    };

    for (const change of [
      { totalUsers: -1 },
      { completedProfiles: 3.5 },
      { restrictedUsers: 11 },
      { onlineUsers: 11 },
      { subscribers: 11 },
      { subscribers: Number.NaN },
    ]) {
      assert.throws(() =>
        buildAdminUserOverview({
          ...original,
          ...change,
        })
      );
    }
  });

  it('returns only the explicit aggregate schema', () => {
    const result = buildAdminUserOverview({
      totalUsers: 1,
      completedProfiles: 1,
      restrictedUsers: 0,
      onlineUsers: 0,
      subscribers: 0,
      email: 'private@example.invalid',
      paymentDetails: 'private',
    } as Parameters<typeof buildAdminUserOverview>[0]);

    assert.deepEqual(Object.keys(result).sort(), [
      'totalUsers',
      'completedProfiles',
      'incompleteProfiles',
      'restrictedUsers',
      'onlineUsers',
      'subscribers',
    ].sort());

    assert.equal(
      JSON.stringify(result).includes('private@example.invalid'),
      false
    );
  });
});

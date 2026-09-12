import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCommunityNotificationMembershipCycleCurrent,
  resolveCommunityNotificationMembershipCycleStartedAtMs,
  shouldReconcileCommunityNotificationMembership,
} from './community-notification-membership.policy';

const timestamp = (milliseconds: number) => ({
  toMillis: () => milliseconds,
});

test('ciclo social existe somente para membership ativa com marcador canônico', () => {
  assert.equal(
    resolveCommunityNotificationMembershipCycleStartedAtMs({
      status: 'active',
      joinedAt: timestamp(1_000),
    }),
    1_000
  );
  assert.equal(
    resolveCommunityNotificationMembershipCycleStartedAtMs({
      status: 'pending',
      joinedAt: timestamp(1_000),
    }),
    null
  );
  assert.equal(
    resolveCommunityNotificationMembershipCycleStartedAtMs({
      status: 'left',
      joinedAt: timestamp(1_000),
    }),
    null
  );
  assert.equal(
    resolveCommunityNotificationMembershipCycleStartedAtMs({
      status: 'blocked',
      joinedAt: timestamp(1_000),
    }),
    null
  );
  assert.equal(
    resolveCommunityNotificationMembershipCycleStartedAtMs({ status: 'active' }),
    null
  );
});

test('desbloqueio inicia novo ciclo sem depender de campo paralelo', () => {
  const membership = {
    status: 'active',
    joinedAt: timestamp(1_000),
    unblockedAt: timestamp(2_000),
  };

  assert.equal(
    resolveCommunityNotificationMembershipCycleStartedAtMs(membership),
    2_000
  );
  assert.equal(
    isCommunityNotificationMembershipCycleCurrent(membership, 2_000),
    true
  );
  assert.equal(
    isCommunityNotificationMembershipCycleCurrent(membership, 1_000),
    false
  );
});

test('reentrada invalida atividade do ciclo anterior', () => {
  const previous = {
    status: 'active',
    joinedAt: timestamp(1_000),
  };
  const left = {
    status: 'left',
    joinedAt: timestamp(1_000),
  };
  const rejoined = {
    status: 'active',
    joinedAt: timestamp(3_000),
  };

  assert.equal(shouldReconcileCommunityNotificationMembership(previous, left), true);
  assert.equal(shouldReconcileCommunityNotificationMembership(left, rejoined), true);
  assert.equal(isCommunityNotificationMembershipCycleCurrent(rejoined, 1_000), false);
  assert.equal(isCommunityNotificationMembershipCycleCurrent(rejoined, 3_000), true);
});

test('mudança de role no mesmo ciclo não dispara reconciliação social', () => {
  const before = {
    status: 'active',
    role: 'member',
    joinedAt: timestamp(1_000),
  };
  const after = {
    status: 'active',
    role: 'moderator',
    joinedAt: timestamp(1_000),
  };

  assert.equal(shouldReconcileCommunityNotificationMembership(before, after), false);
});
